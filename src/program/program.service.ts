// src/program/program.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Message } from '@prisma/client';
import { setTimeout } from 'timers/promises';
import { ChatService } from 'src/chat/chat.service';
import { ChatAdmin } from 'src/chat/chat.admin';
import { Gpt4oState } from './gpt-4o/gpt-4o.state';
import { o3MiniState } from './o3-mini/o3-mini.state';
import { ClaudeState } from './claude/claude.state';
import { GeminiState } from './gemini/gemini.state';
import { GrokState } from './grok/grok.state';
import { LlamaState } from './llama/llama.state';
import { DeepseekState } from './deepseek/deepseek.state';
import { LastInWinsMutex } from './program.mutex';
import { ProgramEvents } from 'src/events/program.events';
import { QwenState } from './qwen/qwen.state';
import { KimiState } from './kimi/kimi.state';
import { StepState } from './step/step.state';
import { WebSearchAgentState } from './web-search-agent/web-search-agent.state';
import { CodeExecutorState } from './code-executor/code-executor.state';

@Injectable()
export class ProgramService implements OnModuleInit {
  private userId = 'user';
  private programIds: string[] = [];
  private programStates: Map<string, any> = new Map();
  private currentDelay: number = 0;
  private isPaused: boolean = false;
  private pendingMessages: Map<string, Map<string, any>> = new Map();
  private memberChatLocks: Map<string, LastInWinsMutex> = new Map();
  private messageCounter: number = 0;
  private autoPauseThreshold: number = 12;
  private isAutoPauseEnabled: boolean = false;

  constructor(
    private readonly chatService: ChatService,
    private readonly chatAdmin: ChatAdmin,
    private readonly programEvents: ProgramEvents,
    private readonly gpt4oState: Gpt4oState,
    private readonly o3MiniState: o3MiniState,
    private readonly claudeState: ClaudeState,
    private readonly geminiState: GeminiState,
    private readonly grokState: GrokState,
    private readonly llamaState: LlamaState,
    private readonly deepseekState: DeepseekState,
    private readonly qwenState: QwenState,
    private readonly kimiState: KimiState,
    private readonly stepState: StepState,
    private readonly webSearchAgentState: WebSearchAgentState,
    private readonly codeExecutorState: CodeExecutorState,
  ) {
    this.programStates.set('gpt-4o', this.gpt4oState);
    this.programStates.set('o3-mini', this.o3MiniState);
    this.programStates.set('sonnet-3.7', this.claudeState);
    this.programStates.set('gemini-2.0-flash', this.geminiState);
    this.programStates.set('grok-2', this.grokState);
    this.programStates.set('llama-3.3', this.llamaState);
    this.programStates.set('deepseek-r1', this.deepseekState);
    this.programStates.set('qwen-max', this.qwenState);
    this.programStates.set('kimi-latest', this.kimiState);
    this.programStates.set('step-2-16k', this.stepState);
    this.programStates.set('web-search-agent', this.webSearchAgentState);
    this.programStates.set('code-executor', this.codeExecutorState);
  }

  async onModuleInit() {
    this.programIds = await this.getAllProgramIds();

    await Promise.all(
      this.programIds.flatMap((programId) => [
        this.chatService.initAllQueuesConsumption(
          programId,
          (message: Message) => this.handleMessage(programId, message),
        ),
        this.chatService.initServiceQueueConsumption(
          programId,
          (message: any) => this.handleServiceMessage(programId, message),
        ),
      ]),
    );

    // Subscribe to resume events
    this.programEvents.resumeProgram$.subscribe(() => {
      this.resume();
    });
  }

  async handleMessage(memberId: string, message: Message) {
    if (message.senderId === memberId) {
      return;
    }

    if (message.senderId === this.userId) {
      this.messageCounter = 0;
    }

    const chatId = message.chatId;

    const memberChatKey = this.getMemberChatKey(memberId, chatId);

    let memberChatLock = this.memberChatLocks.get(memberChatKey);
    if (!memberChatLock) {
      memberChatLock = new LastInWinsMutex();
      this.memberChatLocks.set(memberChatKey, memberChatLock);
    }

    let release: () => void;
    try {
      release = await memberChatLock.acquire();
    } catch (error) {
      // If we get here, it means this handleMessage call was discarded in favor of a newer one.
      console.warn('Lock acquisition canceled:', error.message);
      return;
    }

    try {
      if (this.isPaused) {
        this.setPending(memberId, message);
        console.log('handleMessage paused');
        return;
      }

      if (this.isAutoPauseEnabled) {
        this.messageCounter++;
        if (this.messageCounter >= this.autoPauseThreshold) {
          this.messageCounter = 0;
          this.pause();
          this.setPending(memberId, message);
          console.log(`Auto-paused after ${this.autoPauseThreshold} messages`);
          return;
        }
      }

      await this.applyDelay();

      const replyFunction = this.getReplyFunction(memberId);
      const reply = await replyFunction(chatId);

      if (reply) {
        await this.chatAdmin.sendMessage(chatId, reply, memberId);
      } else {
        console.log(`${memberId} chose not to reply to chat ${chatId}.`);
      }
    } catch (error) {
      console.error('Failed to handle message:', error.message);
    } finally {
      release();
    }
  }

  async handleServiceMessage(memberId: string, message: any) {
    if (message.notification == 'NEW_CHAT' && message.chatId) {
      await this.chatService.initQueueConsumption(
        memberId,
        message.chatId,
        (message: Message) => this.handleMessage(memberId, message),
      );
      console.log(
        `Queue to chat ${message.chatId} initialized for member ${memberId}.`,
      );
    }
  }

  private async getAllProgramIds(): Promise<string[]> {
    const members = await this.chatService.getAllMembers();
    const memberIds = members
      .filter((member) => member.type === 'PROGRAM')
      .map((member) => member.id);
    return memberIds;
  }

  private getReplyFunction(memberId: string): (chatId: string) => Promise<any> {
    const programState = this.programStates.get(memberId);
    if (!programState) {
      throw new Error(`Unknown program ID: ${memberId}`);
    }
    return programState.reply.bind(programState);
  }

  private getMemberChatKey(memberId: string, chatId: string): string {
    return `${memberId}:${chatId}`;
  }

  private setPending(memberId: string, message: any) {
    if (!this.pendingMessages.has(memberId)) {
      this.pendingMessages.set(memberId, new Map());
    }
    const memberMessages = this.pendingMessages.get(memberId)!;
    memberMessages.set(message.chatId, message);
  }

  setDelay(delay: number): void {
    this.currentDelay = delay;
  }

  async applyDelay(): Promise<void> {
    if (this.currentDelay > 0) {
      await setTimeout(this.currentDelay);
    }
  }

  pause() {
    this.isPaused = true;
    this.programEvents.emitPauseStatus({
      paused: true,
      messageCount: this.messageCounter,
      threshold: this.autoPauseThreshold,
      isAutoPause: this.isAutoPauseEnabled,
    });
    console.log('Message handling paused.');
  }

  async resume() {
    this.isPaused = false;
    this.messageCounter = 0;
    this.programEvents.emitPauseStatus({
      paused: false,
      messageCount: 0,
      threshold: this.autoPauseThreshold,
      isAutoPause: this.isAutoPauseEnabled,
    });
    console.log(
      `Message handling resumed with delay of ${this.currentDelay} milliseconds.`,
    );

    const processingPromises: Promise<void>[] = [];

    for (const [memberId, chatMessages] of this.pendingMessages) {
      for (const [, message] of chatMessages) {
        processingPromises.push(this.handleMessage(memberId, message));
      }
    }

    await Promise.all(processingPromises);
    this.pendingMessages.clear();
  }

  setAutoPause(enabled: boolean, threshold?: number) {
    this.isAutoPauseEnabled = enabled;
    if (threshold !== undefined) {
      this.autoPauseThreshold = threshold;
    }
    this.messageCounter = 0;
    console.log(
      `Auto-pause ${enabled ? 'enabled' : 'disabled'}${
        enabled ? ` with threshold of ${this.autoPauseThreshold} messages` : ''
      }`,
    );
  }

  getAutoPauseStatus() {
    return {
      enabled: this.isAutoPauseEnabled,
      threshold: this.autoPauseThreshold,
      currentCount: this.messageCounter,
    };
  }
}
