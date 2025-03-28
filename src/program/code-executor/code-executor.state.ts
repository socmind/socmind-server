// src/program/code-executor/code-executor.state.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatService } from 'src/chat/chat.service';
import OpenAI from 'openai';
import { AppGateway } from 'src/gateway/app.gateway';
import { Sandbox } from '@e2b/code-interpreter';

@Injectable()
export class CodeExecutorState {
  private readonly memberId = 'code-executor';
  private readonly openAi: OpenAI;

  constructor(
    private readonly configService: ConfigService,
    private readonly chatService: ChatService,
    private readonly appGateway: AppGateway,
  ) {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
    const e2bApiKey = this.configService.get<string>('E2B_API_KEY');
    process.env.E2B_API_KEY = apiKey;
    this.openAi = new OpenAI({ apiKey });
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

      const tools: OpenAI.ChatCompletionTool[] = [
        {
          type: 'function',
          function: {
            name: 'execute_python',
            description:
              'Execute python code in a Jupyter notebook cell and return result',
            parameters: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'The python code to execute in a single cell',
                },
              },
              required: ['code'],
            },
          },
        },
      ];

      const response = await this.openAi.chat.completions.create({
        model: 'gpt-4o',
        messages: formattedMessages,
        tools: tools,
        tool_choice: 'auto',
      });

      if (response) {
        const responseMessage = response.choices[0].message;

        if (
          responseMessage.tool_calls &&
          responseMessage.tool_calls.length > 0
        ) {
          for (const tool_call of responseMessage.tool_calls) {
            if (tool_call.function.name === 'execute_python') {
              // Create a sandbox and execute the code
              const sandbox = await Sandbox.create();
              try {
                const args = JSON.parse(tool_call.function.arguments);
                const code: string = args.code;
                const execution = await sandbox.runCode(code);
                const result = execution.text;

                // Send the result back to the model
                formattedMessages.push({
                  role: 'user',
                  content: result,
                });
              } catch (error) {
                console.error('Error executing code:', error);
                formattedMessages.push({
                  role: 'user',
                  content: 'Error executing code: ' + error.message,
                });
              }
            }
          }

          const finalMessage = await this.openAi.chat.completions.create({
            model: 'gpt-4o',
            messages: formattedMessages,
          });
          return { text: finalMessage.choices[0].message.content };
        }

        if (responseMessage.content.toLowerCase().includes('nihil dicendum')) {
          return;
        } else {
          return { text: responseMessage.content };
        }
      } else {
        throw new Error('No content received from OpenAI or E2B.');
      }
    } catch (error) {
      console.error('Error calling OpenAI or E2B:', error);
      throw new Error('Failed to get response from OpenAI or E2B.');
    } finally {
      this.appGateway.sendTypingIndicator(chatId, this.memberId, false);
    }
  }
}
