// src/chat/chat.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { MessageType, Prisma, Message } from '@prisma/client';
import { PrismaService } from './infrastructure/database/prisma.service';
import { RabbitMQService } from './infrastructure/message-broker/rabbitmq.service';
import { ChatPrompts } from './chat.prompts';

@Injectable()
export class ChatService implements OnModuleInit {
  private chatDirectory: Map<string, string[]> = new Map();
  private readonly userId = 'user';

  constructor(
    private prismaService: PrismaService,
    private rabbitMQService: RabbitMQService,
    private chatPrompts: ChatPrompts,
  ) {}

  async onModuleInit() {
    await this.createServiceQueues();
    await this.initiateDirectory();
  }

  // Main methods
  async publishMessage(
    chatId: string,
    content: any,
    senderId?: string,
  ): Promise<Message> {
    const type: MessageType = senderId ? 'MEMBER' : 'SYSTEM';

    const messageData: Prisma.MessageCreateInput = {
      chat: { connect: { id: chatId } },
      content: content,
      type: type,
    };

    if (senderId) {
      const memberExists = await this.prismaService.findMemberById(senderId);
      if (!memberExists) {
        throw new Error(`Member with id ${senderId} not found.`);
      }
      messageData.sender = { connect: { id: senderId } };
    }

    const message = await this.prismaService.createMessage(messageData);

    try {
      await this.rabbitMQService.sendMessage(message);
    } catch (error) {
      console.error('Failed to send message to RabbitMQ:', error);
      throw error;
    }

    return message;
  }

  async createChat(
    memberIds: string[],
    name?: string,
    topic?: string,
    creator?: string,
  ) {
    // Ensure this.userId is included in the members list if not already present
    const allMemberIds = [...new Set([...memberIds, this.userId])];

    const chatData: Prisma.ChatCreateInput = {
      members: {
        create: allMemberIds.map((memberId) => ({
          member: { connect: { id: memberId } },
        })),
      },
    };

    if (name) {
      chatData.name = name;
    }

    if (creator) {
      chatData.creator = creator;
    }

    const chat = await this.prismaService.createChat(chatData);

    await this.rabbitMQService.createOrAddMembersToGroupChat(
      chat.id,
      allMemberIds,
    );

    const context = await this.setChatContext(allMemberIds, chat.id, topic);

    for (const memberId of allMemberIds) {
      await this.rabbitMQService.sendServiceMessage(memberId, {
        notification: 'NEW_CHAT',
        chatId: chat.id,
      });
    }

    this.updateDirectory(chat.id, allMemberIds);

    console.log(`Chat ${chat.id} created with members: ${allMemberIds}.`);

    return { ...chat, context };
  }

  async setChatContext(
    memberIds: string[],
    chatId: string,
    topic?: string,
  ): Promise<string> {
    const members = await this.prismaService.getMembersByIds(memberIds);

    const memberInfo = members
      .map((member) => {
        if (member.description) {
          return `${member.name}: ${member.description}`;
        }
        return `${member.name}`;
      })
      .join('\n');

    const directory = `Conversation created with the following members:\n${memberInfo}\n`;

    const guidelines = this.chatPrompts.getTaskDelegationPrompt();

    if (topic) {
      const topicMessage = `Here is the topic for the present discussion: ${topic}.\n`;
      const conclusionPrompt = this.chatPrompts.getConclusionPrompt();
      const context = directory + topicMessage + conclusionPrompt + guidelines;

      await this.publishMessage(chatId, { text: context });

      console.log(`Context sent to chat ${chatId}: ${context}.`);
      return context;
    } else {
      const context = directory + guidelines;

      await this.prismaService.updateChat(chatId, {
        context: context,
      });

      const messageData: Prisma.MessageCreateInput = {
        chat: { connect: { id: chatId } },
        content: { text: context },
        type: 'SYSTEM',
      };

      await this.prismaService.createMessage(messageData);

      console.log(`Context added to chat ${chatId}: ${context}.`);
      return context;
    }
  }

  async addMemberToChat(
    chatId: string,
    memberId: string,
    chatInstructions?: string,
  ) {
    const chatMember = await this.prismaService.createChatMember(
      chatId,
      memberId,
      chatInstructions,
    );

    await this.rabbitMQService.createOrAddMembersToGroupChat(chatId, [
      memberId,
    ]);

    await this.rabbitMQService.createMemberServiceQueue(memberId);

    await this.rabbitMQService.sendServiceMessage(memberId, {
      notification: 'NEW_CHAT',
      chatId: chatId,
    });

    await this.publishMessage(chatId, {
      text: `${memberId} has joined the conversation.`,
    });

    this.updateDirectory(chatId, [memberId]);

    return chatMember;
  }

  async setChatConclusion(chatId: string, conclusion: string) {
    try {
      const updatedChat = await this.prismaService.updateChat(chatId, {
        conclusion: conclusion,
      });
      const msg = { text: `Consensus reached: ${conclusion}.` };
      await this.publishMessage(chatId, msg);

      const chat = await this.prismaService.getChat(chatId);
      if (chat.creator) {
        const report = `Message from group '${chat.name}':\n
        A conclusion has been reached regarding the task '${chat.topic}'.
        Here is the conclusion: '${conclusion}'.`;
        await this.publishMessage(chat.creator, { text: report });
      }

      return updatedChat;
    } catch (error) {
      throw new Error(`Failed to set chat conclusion: ${error.message}`);
    }
  }

  // Message broker methods
  async createServiceQueues() {
    await this.rabbitMQService.createServiceExchange();

    const members = await this.getAllMembers();
    const serviceQueueCreationPromises = members.map((member) =>
      this.rabbitMQService.createMemberServiceQueue(member.id),
    );
    await Promise.all(serviceQueueCreationPromises);

    console.log('Service queues created for all existing members.');
  }

  async initServiceQueueConsumption(
    memberId: string,
    serviceMessageHandler: (message: any) => void,
  ) {
    await this.rabbitMQService.consumeServiceMessage(
      memberId,
      serviceMessageHandler,
    );

    console.log(`${memberId} listening to service exchange.`);
  }

  async initQueueConsumption(
    memberId: string,
    chatId: string,
    messageHandler: (message: Message) => void,
  ) {
    await this.rabbitMQService.consumeMessages(
      memberId,
      chatId,
      messageHandler,
    );
  }

  async initAllQueuesConsumption(
    memberId: string,
    messageHandler: (message: Message) => void,
  ) {
    const chats = await this.getMemberChats(memberId);

    const initializationPromises = chats.map((chat) =>
      this.initQueueConsumption(memberId, chat.id, messageHandler),
    );

    await Promise.all(initializationPromises);

    console.log(`Chat queues initialized for member ${memberId}.`);
  }

  // Database methods
  async getAllMembers() {
    const members = await this.prismaService.getAllMembers();
    return members;
  }

  async updateMember(memberId: string, memberData: Prisma.MemberUpdateInput) {
    const updatedMember = await this.prismaService.updateMember(
      memberId,
      memberData,
    );
    return updatedMember;
  }

  async getMemberChats(memberId: string) {
    const chats = await this.prismaService.getMemberChats(memberId);
    return chats;
  }

  async getAllChats() {
    const chats = await this.prismaService.getAllChats();

    const simplifiedChats = chats.map((chat) => ({
      memberIds: chat.members.map((member) => member.memberId),
      id: chat.id,
      name: chat.name as string | null,
      context: chat.context as string | null,
      creator: chat.creator as string | null,
      topic: chat.topic as string | null,
      conclusion: chat.conclusion as string | null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    }));

    return simplifiedChats;
  }

  async updateChat(chatId: string, chatData: Prisma.ChatUpdateInput) {
    const updatedChat = await this.prismaService.updateChat(chatId, chatData);
    return updatedChat;
  }

  async getInitialChatData() {
    const chats = await this.prismaService.getAllChatsWithLatestMessage();
    return chats;
  }

  async getMemberMetadata(memberId: string) {
    const memberMetadata = await this.prismaService.getMember(memberId);
    return memberMetadata;
  }

  async getChat(chatId: string) {
    const chat = await this.prismaService.getChat(chatId);
    return chat;
  }

  async getChatWithMembers(chatId: string) {
    const chat = await this.prismaService.getChatWithMembers(chatId);

    const simplifiedChat = {
      id: chat.id,
      name: chat.name as string | null,
      context: chat.context as string | null,
      creator: chat.creator as string | null,
      topic: chat.topic as string | null,
      conclusion: chat.conclusion as string | null,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      memberIds: chat.members.map((member) => member.memberId),
    };

    return simplifiedChat;
  }

  async getConversationHistory(chatId: string): Promise<Message[]> {
    const conversation = await this.prismaService.getChatHistory(chatId);
    return conversation;
  }

  // In-memory methods
  async initiateDirectory() {
    const allChats = await this.prismaService.getAllChats();
    allChats.forEach((chat) => {
      const chatId = chat.id;
      const memberIds = chat.members.map((member) => member.memberId);
      this.chatDirectory.set(chatId, memberIds);
    });
  }

  getChatDirectory() {
    return this.chatDirectory;
  }

  updateDirectory(chatId: string, memberIds: string[]): void {
    if (this.chatDirectory.has(chatId)) {
      const existingMemberIds = this.chatDirectory.get(chatId)!;
      const updatedMemberIds = Array.from(
        new Set([...existingMemberIds, ...memberIds]),
      );
      this.chatDirectory.set(chatId, updatedMemberIds);
    } else {
      this.chatDirectory.set(chatId, [...new Set(memberIds)]);
    }
  }
}
