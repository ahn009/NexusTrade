// services/trading-service/src/gateways/trading.gateway.ts
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ namespace: '/user-stream', cors: true })
export class TradingGateway {
  @WebSocketServer()
  server!: Server;

  publishUserOrder(userId: string, payload: unknown) {
    this.server?.to(userId).emit('order.update', payload);
  }
}
