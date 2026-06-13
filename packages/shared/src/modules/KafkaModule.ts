// packages/shared/src/modules/KafkaModule.ts
import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Consumer, EachMessagePayload, Kafka, KafkaConfig, Producer } from 'kafkajs';
import { readFileSync } from 'fs';

export interface KafkaConsumeOptions {
  topic: string;
  groupId: string;
  fromBeginning?: boolean;
  partitionsConsumedConcurrently?: number;
}

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private readonly brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',').map((broker) => broker.trim()).filter(Boolean);
  private readonly dlqTopic = process.env.KAFKA_DLQ_TOPIC ?? 'nexus.dlq';
  private readonly kafka = new Kafka(createKafkaConfig(this.brokers));
  private readonly producer: Producer = this.kafka.producer();
  private readonly consumers: Consumer[] = [];
  private producerConnected = false;

  async onModuleInit() {
    try {
      await this.connectProducer();
    } catch (error) {
      this.logger.warn(`Kafka producer not connected during startup: ${(error as Error).message}`);
    }
  }

  async produce<TPayload>(topic: string, payload: TPayload, key?: string) {
    await this.connectProducer();
    await this.withRetry(() =>
      this.producer.send({
        topic,
        messages: [{ key, value: JSON.stringify(payload) }]
      })
    );
  }

  async consume<TPayload>(options: KafkaConsumeOptions, handler: (payload: TPayload, raw: EachMessagePayload) => Promise<void>) {
    const consumer = this.kafka.consumer({ groupId: options.groupId });
    this.consumers.push(consumer);
    await this.withRetry(() => consumer.connect());
    await consumer.subscribe({ topic: options.topic, fromBeginning: options.fromBeginning ?? false });
    await consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently: options.partitionsConsumedConcurrently ?? 1,
      eachMessage: async (raw) => {
        try {
          const value = raw.message.value?.toString('utf8');
          if (value) {
            await handler(JSON.parse(value) as TPayload, raw);
          }
        } catch (error) {
          await this.sendToDlq(options.topic, raw, error as Error);
        } finally {
          await consumer.commitOffsets([{ topic: raw.topic, partition: raw.partition, offset: nextOffset(raw.message.offset) }]);
        }
      }
    });
  }

  async onModuleDestroy() {
    await Promise.all(this.consumers.map((consumer) => consumer.disconnect()));
    if (this.producerConnected) {
      await this.producer.disconnect();
    }
  }

  private async connectProducer() {
    if (this.producerConnected) return;
    await this.withRetry(() => this.producer.connect());
    this.producerConnected = true;
  }

  private async sendToDlq(sourceTopic: string, raw: EachMessagePayload, error: Error) {
    try {
      await this.produce(this.dlqTopic, {
        sourceTopic,
        partition: raw.partition,
        offset: raw.message.offset,
        error: error.message,
        payload: raw.message.value?.toString('utf8') ?? null,
        failedAt: new Date().toISOString()
      }, `${sourceTopic}:${raw.partition}:${raw.message.offset}`);
    } catch (dlqError) {
      this.logger.error(`failed to write DLQ message: ${(dlqError as Error).message}`);
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    let delayMs = 100;
    for (;;) {
      try {
        return await operation();
      } catch (error) {
        attempt += 1;
        if (attempt >= 5) throw error;
        this.logger.warn(`Kafka operation failed, retrying in ${delayMs}ms: ${(error as Error).message}`);
        await delay(delayMs);
        delayMs *= 2;
      }
    }
  }
}

@Global()
@Module({ providers: [KafkaService], exports: [KafkaService] })
export class KafkaModule {}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextOffset(offset: string): string {
  return (BigInt(offset) + 1n).toString();
}

function createKafkaConfig(brokers: string[]): KafkaConfig {
  const config: KafkaConfig = {
    clientId: process.env.KAFKA_CLIENT_ID ?? 'nexustrade-service',
    brokers
  };
  if (process.env.KAFKA_SSL === 'true') {
    config.ssl = {
      rejectUnauthorized: process.env.KAFKA_SSL_REJECT_UNAUTHORIZED !== 'false',
      ca: process.env.KAFKA_SSL_CA_PATH ? [readFileSync(process.env.KAFKA_SSL_CA_PATH, 'utf8')] : undefined,
      cert: process.env.KAFKA_SSL_CERT_PATH ? readFileSync(process.env.KAFKA_SSL_CERT_PATH, 'utf8') : undefined,
      key: process.env.KAFKA_SSL_KEY_PATH ? readFileSync(process.env.KAFKA_SSL_KEY_PATH, 'utf8') : undefined
    };
  }
  const mechanism = process.env.KAFKA_SASL_MECHANISM;
  if (mechanism) {
    const username = process.env.KAFKA_SASL_USERNAME;
    const password = process.env.KAFKA_SASL_PASSWORD;
    if (!username || !password) {
      throw new Error('KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required when KAFKA_SASL_MECHANISM is set');
    }
    if (!['plain', 'scram-sha-256', 'scram-sha-512'].includes(mechanism)) {
      throw new Error(`unsupported KAFKA_SASL_MECHANISM: ${mechanism}`);
    }
    config.sasl = { mechanism, username, password } as KafkaConfig['sasl'];
  }
  return config;
}
