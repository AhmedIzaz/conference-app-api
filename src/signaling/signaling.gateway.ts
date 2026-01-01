import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import * as mediasoup from 'mediasoup';

// this means the capabilities of a conference rooms RTP codec capability
// during room creation(means router creation) we have to give this mediaCodecs for that specific room
const mediaCodecs: Omit<
  mediasoup.types.RtpCodecCapability,
  'preferredPayloadType'
>[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
  },
];

type TRoomsPeers = {
  socket: Socket;
  transports: Map<string, mediasoup.types.Transport>;
  consumers: Map<string, mediasoup.types.Consumer>;
  producers: Map<string, mediasoup.types.Producer>;
};

type TRooms = Map<
  string,
  {
    router: mediasoup.types.Router;
    peers: Map<string, TRoomsPeers>;
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
  async handleJoinRoom(
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

    if (!this.rooms.get(room)) {
      const router = await this.worker.createRouter({ mediaCodecs });
      this.rooms.set(room, {
        router,
        peers: new Map(),
      });
    }

    const roomObj = this.rooms.get(room);
    const peer: TRoomsPeers = {
      socket: client,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };

    roomObj?.peers.set(client.id, peer);

    // console.log({theRoom: this.rooms.get(room)})

    client.join(room);
    return true;
  }

  @SubscribeMessage('get-rtp-capabilities')
  handleGetRTPCapabilities(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string },
  ) {
    const { room } = data ?? {};
    const theRoom = this.rooms.get(room);
    if (!theRoom) {
      throw new Error('Room: ' + room + ' Doesnot exist');
    }

    return theRoom.router.rtpCapabilities;
  }

  @SubscribeMessage('create-transport')
  async handleCreateTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string; direction: 'SEND' | 'RECV' },
  ) {
    const { room, direction } = data ?? {};

    const theRoom = this.rooms.get(room);
    if (theRoom) {
      if (direction === 'SEND') {
        const transport = await theRoom.router.createWebRtcTransport({
          listenIps: [{ announcedIp: '127.0.0.1', ip: '0.0.0.0' }],
          enableSctp: true,
          enableTcp: true,
          enableUdp: true,
        });

        const peer = theRoom.peers.get(client.id);
        peer?.transports.set(transport.id, transport);

        return {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        };
      } else {
      }
    }
  }

  @SubscribeMessage('connect-sendTransport')
  async handleConnectSendTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      room: string;
      transportId: string;
      dtlsParameters: mediasoup.types.DtlsParameters;
    },
  ) {

    const { room, transportId, dtlsParameters } = data ?? {};

     console.log(
      'handleConnectSendTransport ================ Client: ',
      client.id,
      ' room: ',
      room
    );
    const theRoom = this.rooms.get(room);
    if (theRoom) {
      const peer = theRoom.peers.get(client.id);
      if (peer) {
        const transport = peer.transports.get(transportId);
        if (transport) {
          await transport.connect({ dtlsParameters });
          return true;
        }
      }
    }
    return false;
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
