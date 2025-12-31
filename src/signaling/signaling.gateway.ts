import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import mediasoup from 'mediasoup';

type TRooms = Map<
  string,
  {
    router: mediasoup.types.Router;
    peers: Map<
      [socketId: string],
      {
        socket: Socket;
        transports: Map<string, mediasoup.types.Transport>;
        consumers: Map<string, mediasoup.types.Consumer>;
        producers: Map<string, mediasoup.types.Producer>;
      }
    >;
  }
>;

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class SignalingGateway {
  worker: mediasoup.types.Worker;
  rooms: TRooms;
  constructor() {
    this.rooms = new Map();
  }

  async onModuleInit() {
    this.worker = await mediasoup.createWorker({
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    });

    console.log(
      'Worker for media soup created during on module init: ',
      this.worker,
    );
  }

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

    let theRoom = this.rooms.get('MAIN');

    if (!theRoom) {
      // const router = await;
    }

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
