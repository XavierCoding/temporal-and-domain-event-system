import amqplib from "amqplib";
import { config } from "../config.js";
import { logger } from "../logger.js";

let _connection: amqplib.Connection | null = null;
let _channel: amqplib.Channel | null = null;

export async function getChannel(): Promise<amqplib.Channel> {
  if (_channel) return _channel;

  logger.info({ url: config.RABBITMQ_URL }, "connecting to RabbitMQ");
  _connection = await amqplib.connect(config.RABBITMQ_URL);
  _channel = await _connection.createChannel();

  // Assert the stream queue
  await _channel.assertQueue(config.STREAM_NAME, {
    durable: true,
    arguments: { "x-queue-type": "stream" },
  });

  // Backpressure: process one message at a time
  await _channel.prefetch(1);

  logger.info({ queue: config.STREAM_NAME }, "RabbitMQ channel ready");
  return _channel;
}

export async function closeConnection(): Promise<void> {
  try {
    await _channel?.close();
    await _connection?.close();
    logger.info("RabbitMQ connection closed");
  } catch {
    // ignore errors on shutdown
  }
}
