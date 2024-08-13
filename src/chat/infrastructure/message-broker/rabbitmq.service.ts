// src/infrastructure/message-broker/rabbitmq.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Message } from '@prisma/client';
import * as amqplib from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqplib.Connection;
  private channel: amqplib.Channel;
  private serviceExchange = 'service_exchange';

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const rabbitmqUrl = this.configService.get<string>('RABBITMQ_URL');
    this.connection = await amqplib.connect(rabbitmqUrl);
    this.channel = await this.connection.createChannel();
    await this.createServiceExchange();
    console.log('RabbitMQ initialized.');
  }

  async onModuleDestroy() {
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }

  // Exchange and queue creation/deletion
  async createServiceExchange() {
    await this.channel.assertExchange(this.serviceExchange, 'direct', {
      durable: true,
    });
  }

  async createMemberServiceQueue(memberId: string) {
    const queueName = `${memberId}_service_queue`;
    await this.channel.assertQueue(queueName, { durable: true });
    await this.channel.bindQueue(queueName, this.serviceExchange, memberId);
  }

  async createOrAddMembersToGroupChat(chatId: string, memberIds: string[]) {
    const exchange = `${chatId}_exchange`;
    await this.channel.assertExchange(exchange, 'fanout', { durable: true });

    for (const member of memberIds) {
      const queueName = `${chatId}_${member}_queue`;
      await this.channel.assertQueue(queueName, { durable: true });
      await this.channel.bindQueue(queueName, exchange, '');
    }
  }

  async removeMembersFromGroupChat(chatId: string, memberIds: string[]) {
    const exchange = `${chatId}_exchange`;

    for (const memberId of memberIds) {
      const queueName = `${chatId}_${memberId}_queue`;

      await this.channel.unbindQueue(queueName, exchange, '');
      await this.channel.deleteQueue(queueName);
    }
  }

  // Consumption
  async consumeMessages(
    memberId: string,
    chatId: string,
    callback: (message: Message) => void,
  ) {
    const exchange = `${chatId}_exchange`;
    const queueName = `${chatId}_${memberId}_queue`;
    await this.channel.assertExchange(exchange, 'fanout', { durable: true });
    await this.channel.assertQueue(queueName, { durable: true });
    await this.channel.bindQueue(queueName, exchange, '');

    try {
      await this.channel.consume(queueName, (msg) => {
        if (msg !== null) {
          try {
            const content = JSON.parse(msg.content.toString());
            callback(content);
            this.channel.ack(msg);
          } catch (parseError) {
            console.error('Failed to parse message:', parseError);
            this.channel.nack(msg);
          }
        }
      });
      console.log(
        `${memberId} is now listening for messages from chat ${chatId}.`,
      );
    } catch (consumeError) {
      console.error(`Failed to initialize queue ${queueName}: ${consumeError}`);
    }
  }

  async consumeServiceMessage(
    memberId: string,
    callback: (message: any) => void,
  ) {
    const queueName = `${memberId}_service_queue`;

    await this.channel.consume(queueName, (msg) => {
      if (msg !== null) {
        const content = JSON.parse(msg.content.toString());
        callback(content);
        this.channel.ack(msg);
      }
    });
  }

  // Publishing
  async sendMessage(message: Message) {
    if (message?.chatId === undefined) {
      throw new Error('Missing message.chatId.');
    }

    const exchange = `${message.chatId}_exchange`;
    const messageBuffer = Buffer.from(JSON.stringify(message));

    const sent = this.channel.publish(exchange, '', messageBuffer, {
      persistent: true,
      contentType: 'application/json',
    });

    if (!sent) {
      console.warn('Message was not sent.');
    }
  }

  async sendServiceMessage(memberId: string, message: any) {
    const messageBuffer = Buffer.from(JSON.stringify(message));

    this.channel.publish(this.serviceExchange, memberId, messageBuffer, {
      persistent: true,
      contentType: 'application/json',
    });
  }
}
