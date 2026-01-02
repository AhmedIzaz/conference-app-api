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
          appData: { direction },
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
      room,
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
  @SubscribeMessage('connect-recvTransport')
  async handleConnectRecvTransport(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      room: string;
      transportId: string;
      dtlsParameters: mediasoup.types.DtlsParameters;
    },
  ) {
    const { room, transportId, dtlsParameters } = data;

    const theRoom = this.rooms.get(room);
    const peer = theRoom?.peers.get(client.id);
    const transport = peer?.transports.get(transportId);

    if (!transport) throw new Error('Transport not found');

    await transport.connect({ dtlsParameters });

    return true;
  }

  @SubscribeMessage('produce')
  async handleProduce(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      room: string;
      kind: mediasoup.types.MediaKind;
      rtpParameters: mediasoup.types.RtpParameters;
      transportId: string;
    },
  ) {
    const { room, transportId, kind, rtpParameters } = data ?? {};

    const theRoom = this.rooms.get(room);
    if (!theRoom) throw new Error('Room does not exist');

    const peer = theRoom.peers.get(client.id);
    if (!peer) throw new Error('Peer doesnot exist');

    const transport = peer.transports.get(transportId);
    if (!transport) throw new Error('Transport doesnot exist');

    const producer = await transport.produce({
      kind,
      rtpParameters,
    });

    peer.producers.set(producer.id, producer);

    // now notify other clients of the room that a new producer added in the room
    client.to(room).emit('new-producer', {
      producerId: producer.id,
      peerId: client.id,
      kind: producer.kind,
    });

    // optional but Recomend
    const producerDeletor = () => {
      peer.producers.delete(producer.id);
    };
    producer.on('transportclose', producerDeletor);
    producer.on('@close', producerDeletor);

    return { id: producer.id };
  }

  @SubscribeMessage('consume')
  async handleConsume(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      room: string;
      producerId: string;
      rtpCapabilities: mediasoup.types.RtpCapabilities;
    },
  ) {
    const { room, producerId, rtpCapabilities } = data ?? {};

    const theRoom = this.rooms.get(room);
    if (!theRoom) throw new Error('Room doesnot exist');

    const router = theRoom.router;
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error('Cannot consume this producers');
    }

    const peer = theRoom.peers.get(client.id);
    if (!peer) throw new Error('Peer not found');

    const transport = [...peer.transports.values()].find(
      (t) => t.appData?.direction === 'RECV',
    );
    if (!transport) throw new Error('RECV transport not found');

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true,
    });

    peer.consumers.set(consumer.id, consumer);

    // Cleanup
    consumer.on('transportclose', () => {
      peer.consumers.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      peer.consumers.delete(consumer.id);
      client.emit('producer-closed', {
        producerId,
      });
    });

    return {
      id: consumer.id,
      producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  @SubscribeMessage('resume-consumer')
  async handleResumeConsumer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      room: string;
      consumerId: string;
    },
  ) {
    const { room, consumerId } = data;

    const theRoom = this.rooms.get(room);
    const peer = theRoom?.peers.get(client.id);
    const consumer = peer?.consumers.get(consumerId);

    if (!consumer) throw new Error('Consumer not found');

    await consumer.resume();

    return true;
  }

  ////////////////////////////////////////////////
  ///////////////////////////////////////////////

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
