// src/program/deepseek/deepseek.state.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatService } from 'src/chat/chat.service';
import OpenAI from 'openai';
import { AppGateway } from 'src/gateway/app.gateway';

@Injectable()
export class DeepseekState {
  private readonly memberId = 'deepseek-r1';
  private readonly openAi: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    private readonly appGateway: AppGateway,
  ) {
    const apiKey = this.configService.get<string>('HYPERBOLIC_API_KEY');
    this.openAi = new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://api.hyperbolic.xyz/v1',
    });
  }

  private determineMessageRole(message: any): 'system' | 'assistant' | 'user' {
    if (message.type === 'SYSTEM') return 'system';
    return message.senderId === this.memberId ? 'assistant' : 'user';
  }

  async getConversation(chatId: string) {
    const messages = await this.chatService.getConversationHistory(chatId);
    const memberMetadata = await this.chatService.getMemberMetadata(
      this.memberId,
    );
    const systemMessage = memberMetadata.systemMessage;
    const chatMember = memberMetadata.chats.find(
      (chat) => chat.chatId === chatId,
    );
    const chatInstructions = chatMember?.chatInstructions;

    const formattedMessages = messages.map((message) => ({
      role: this.determineMessageRole(message),
      content: (message.content as { text: string }).text ?? '',
    }));

    const combinedInstructions = [systemMessage, chatInstructions]
      .filter(Boolean)
      .join('\n');

    if (combinedInstructions) {
      formattedMessages.unshift({
        role: 'system',
        content: combinedInstructions,
      });
    }

    return formattedMessages;
  }

  async reply(chatId: string) {
    try {
      this.appGateway.sendTypingIndicator(chatId, this.memberId, true);

      const formattedMessages = await this.getConversation(chatId);

      if (
        formattedMessages.length > 0 &&
        formattedMessages[formattedMessages.length - 1].role === 'assistant'
      ) {
        return;
      }

      const response = await this.openAi.chat.completions.create({
        model: 'deepseek-ai/DeepSeek-R1',
        messages: formattedMessages,
      });

      if (response.choices.length > 0) {
        const message = response.choices[0].message;
        const content = message.content.trim();

        if (content.toLowerCase().includes('nihil dicendum')) {
          return;
        } else {
          return { text: content };
        }
      } else {
        throw new Error('No content received from Hyperbolic.');
      }
    } catch (error) {
      console.error('Error calling Hyperbolic:', error);
      throw new Error('Failed to get response from Hyperbolic.');
    } finally {
      this.appGateway.sendTypingIndicator(chatId, this.memberId, false);
    }
  }
}
