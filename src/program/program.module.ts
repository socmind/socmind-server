// src/program/program.module.ts
import { Module } from '@nestjs/common';
import { ChatModule } from 'src/chat/chat.module';
import { GatewayModule } from 'src/gateway/gateway.module';
import { ProgramService } from './program.service';
import { ProgramController } from './program.controller';
import { LastInWinsMutex } from './program.mutex';
import { GptState } from './gpt/gpt.state';
import { ClaudeState } from './claude/claude.state';
import { GeminiState } from './gemini/gemini.state';
import { GrokState } from './grok/grok.state';
import { LlamaState } from './llama/llama.state';
import { DeepseekState } from './deepseek/deepseek.state';
import { QwenState } from './qwen/qwen.state';
import { KimiState } from './kimi/kimi.state';
import { StepState } from './step/step.state';

@Module({
  imports: [
    ChatModule,
    GatewayModule,
  ],
  providers: [
    ProgramService,
    LastInWinsMutex,
    GptState,
    ClaudeState,
    GeminiState,
    GrokState,
    LlamaState,
    DeepseekState,
    QwenState,
    KimiState,
    StepState,
  ],
  controllers: [ProgramController],
})
export class ProgramModule { }
