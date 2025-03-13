// src/program/claude/claude.state.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatService } from 'src/chat/chat.service';
import Anthropic from '@anthropic-ai/sdk';
import { AppGateway } from 'src/gateway/app.gateway';

@Injectable()
export class ClaudeState {
  private readonly memberId = 'sonnet-3.7';
  private readonly anthropic: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    private readonly appGateway: AppGateway,
  ) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.anthropic = new Anthropic({ apiKey });
  }

  private alternateRoles(
    messages: {
      role: string;
      content: string;
    }[],
  ) {
    if (messages.length === 0) return [];

    const result = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
      const currentMessage = messages[i];
      const lastResultMessage = result[result.length - 1];

      if (currentMessage.role === lastResultMessage.role) {
        lastResultMessage.content += '\n' + currentMessage.content;
      } else {
        result.push(currentMessage);
      }
    }

    return result;
  }

  async getConversation(chatId: string) {
    const messages = await this.chatService.getConversationHistory(chatId);

    const formattedMessages = messages.map((message) => ({
      role: message.senderId === this.memberId ? 'assistant' : 'user',
      content: (message.content as { text: string }).text,
    }));

    return this.alternateRoles(formattedMessages);
  }

  async getSystemMessage() {
    const memberMetadata = await this.chatService.getMemberMetadata(
      this.memberId,
    );
    const systemMessage = memberMetadata.systemMessage;

    return systemMessage;
  }

  async reply(chatId: string) {
    try {
      this.appGateway.sendTypingIndicator(chatId, this.memberId, true);

      const formattedMessages = await this.getConversation(chatId);
      const systemMessage = await this.getSystemMessage();

      if (
        formattedMessages.length > 0 &&
        formattedMessages[formattedMessages.length - 1].role === 'assistant'
      ) {
        return;
      }

      const requestBody: {
        model: string;
        messages: any;
        max_tokens: number;
        system?: string;
      } = {
        model: 'claude-3-7-sonnet-20250219',
        messages: formattedMessages,
        max_tokens: 1024,
      };

      if (systemMessage) {
        requestBody.system = systemMessage;
      }

      const response = await this.anthropic.messages.create(requestBody);

      if (response.content.length === 0) {
        return;
      }

      let text = '';
      const contentBlock = response.content[0] as {
        type: string;
        text?: string;
        name?: string;
        input?: any;
        thinking?: string;
      };

      // Handle different content block types
      switch (contentBlock.type) {
        case 'text':
          text += contentBlock.text;
          break;
        case 'tool_use':
          text += `Calling tool '${contentBlock.name}' with input '${JSON.stringify(contentBlock.input)}'.`;
          break;
        case 'thinking':
          text += `Thinking: ${contentBlock.thinking}`;
          break;
        case 'redacted_thinking':
          text += `[Redacted thinking]`;
          break;
        default:
          text += `[Unknown content type]`;
      }

      const content = text.trim();

      if (content.toLowerCase().includes('nihil dicendum')) {
        return;
      } else {
        return { text: content };
      }
    } catch (error) {
      console.error('Error calling Anthropic:', error);
      throw new Error('Failed to get response from Claude.');
    } finally {
      this.appGateway.sendTypingIndicator(chatId, this.memberId, false);
    }
  }
}
