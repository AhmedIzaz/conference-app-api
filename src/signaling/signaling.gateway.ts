import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class SignalingGateway {
  handleConnection(@ConnectedSocket() client: Socket) {
    console.log(
      'handleConnection ================ Client: ',
      client.id,
      ' connected to server through socket',
    );
  }

  handleDisconnect(@ConnectedSocket() client: Socket) {
    console.log(
      'handleDisconnect ================ Client : ',
      client.id,
      ' disconnected from socket server',
    );
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() room: string,
  ) {
    console.log(
      'handleJoinRoom ================ Client: ',
      client.id,
      ' room: ',
      room,
      ' connected to room through socket',
    );
    client.join(room);
  }

  @SubscribeMessage('message')
  handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { message: string },
  ): string {
    console.log(
      'handleMessage ============== client : ',
      client.id,
      ' sent message : ',
      data,
    );
    return 'Hello world!';
  }

  @SubscribeMessage('new-user')
  handleNewUser(
    @ConnectedSocket() socket: Socket,
    @MessageBody() user: string,
  ) {
    console.log('new user emitting: ', user);
    socket.to('MAIN').emit('user-set', user);
    socket.emit('user-set', user);
  }

  @SubscribeMessage('delete-user')
  handleDeleteUser(
    @ConnectedSocket() socket: Socket,
    @MessageBody() user: string,
  ) {
    console.log('delete user emitting: ', user);
    socket.to('MAIN').emit('user-delete', user);
    socket.emit('user-delete', user);
  }
}
