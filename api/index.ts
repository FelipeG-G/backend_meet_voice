/**
 * Voice communication server using Express, Socket.IO, and PeerJS.
 * Handles room management, WebRTC signaling, media toggles,
 * and PeerJS connections for real-time voice calls.
 */

import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { ExpressPeerServer } from 'peer';

dotenv.config();

/**
 * Express app instance used as the base HTTP server.
 * @type {import('express').Express}
 */
const app = express();

const server = http.createServer(app);

app.use(cors({
  origin: process.env.ORIGIN?.split(',') || [
    "http://localhost:5173",
    "https://plataforma-de-video-conferencias.vercel.app"
  ],
  methods: ["GET", "POST"]
}));

/**
 * Main Socket.IO server instance used for voice signaling.
 * Supports cross-origin requests from allowed frontends.
 * @type {Server}
 */
const io = new Server(server, {
  cors: {
    origin: process.env.ORIGIN?.split(',') || [
      "http://localhost:5173",
      "https://plataforma-de-video-conferencias.vercel.app"
    ],
    methods: ["GET", "POST"],
  }
});

/**
 * PeerJS server instance used to assist WebRTC connections.
 * Handles peer-to-peer ID assignments and signaling.
 */
const peerServer = ExpressPeerServer(server, {
  path: '/voice',
  proxied: true,
});

app.use('/peerjs', peerServer);

/**
 * Event fired when a new PeerJS client connects.
 */
peerServer.on('connection', (client) => {
  console.log('[peer] Client connected:', client.getId?.() ?? '(no id)');
});

/**
 * Event fired when a PeerJS client disconnects.
 */
peerServer.on('disconnect', (client) => {
  console.log('[peer] Client disconnected:', client.getId?.() ?? '(no id)');
});

/**
 * Represents the structure of users inside rooms.
 * Each room contains multiple connected clients stored by socket ID.
 * 
 * @typedef {Object} Room
 * @property {Object.<string, Object>} roomId - Dynamic room mapping.
 * @property {string} roomId.socketId.userId - User's unique ID.
 * @property {string} roomId.socketId.displayName - User's display name.
 * @property {string} [roomId.socketId.photoURL] - Optional profile picture.
 */
interface Room {
  [roomId: string]: {
    [socketId: string]: {
      userId: string;
      displayName: string;
      photoURL?: string;
    };
  };
}

/**
 * In-memory container for all active rooms.
 * Not persistent – rooms are deleted when empty.
 * @type {Room}
 */
const rooms: Room = {};

/**
 * Handles all Socket.IO communication for voice rooms.
 * Registers events for joining, WebRTC signaling, media toggling,
 * and cleanup when a user disconnects.
 */
io.on('connection', (socket) => {
  console.log('🔊[voice] User connected:', socket.id);

  /**
   * Fired when a user joins a room.
   * Sends back existing users and notifies the room of the new participant.
   * 
   * @event join:room
   * @param {string} roomId - Unique room identifier.
   * @param {Object} userInfo - Information about the user.
   */
  socket.on('join:room', (roomId: string, userInfo: any) => {
    const currentCount = rooms[roomId] ? Object.keys(rooms[roomId]).length : 0;

    if (currentCount >= 10) {
      socket.emit('room:full');
      return;
    }

    socket.join(roomId);

    if (!rooms[roomId]) rooms[roomId] = {};
    rooms[roomId][socket.id] = userInfo;

    socket.to(roomId).emit('user:joined', {
      socketId: socket.id,
      userInfo,
    });

    const existingUsers = Object.keys(rooms[roomId])
      .filter((id) => id !== socket.id)
      .map((id) => ({
        socketId: id,
        userInfo: rooms[roomId][id],
      }));

    socket.emit('existing:users', existingUsers);
  });

  /**
   * Relays WebRTC offer to the target peer.
   * @event webrtc:offer
   */
  socket.on('webrtc:offer', ({ to, offer, from }) => {
    io.to(to).emit('webrtc:offer', { from, offer });
  });

  /**
   * Relays WebRTC answer to the target peer.
   * @event webrtc:answer
   */
  socket.on('webrtc:answer', ({ to, answer, from }) => {
    io.to(to).emit('webrtc:answer', { from, answer });
  });

  /**
   * Relays ICE candidates between peers.
   * Essential for WebRTC NAT traversal.
   * @event webrtc:ice-candidate
   */
  socket.on('webrtc:ice-candidate', ({ to, candidate, from }) => {
    io.to(to).emit('webrtc:ice-candidate', { from, candidate });
  });

  /**
   * Broadcasts changes in audio/video state to others in the room.
   * @event media:toggle
   */
  socket.on('media:toggle', ({ roomId, type, enabled }) => {
    socket.to(roomId).emit('peer:media-toggle', {
      socketId: socket.id,
      type,
      enabled,
    });
  });

  /**
   * Handles user disconnection and performs cleanup.
   * Removes users from rooms and deletes empty rooms.
   */
  socket.on('disconnect', () => {
    for (const roomId in rooms) {
      if (rooms[roomId][socket.id]) {
        const userInfo = rooms[roomId][socket.id];
        delete rooms[roomId][socket.id];

        socket.to(roomId).emit('user:left', {
          socketId: socket.id,
          userInfo,
        });

        if (Object.keys(rooms[roomId]).length === 0) {
          delete rooms[roomId];
        }

        break;
      }
    }
  });
});

const PORT = Number(process.env.PORT) || 3002;

/**
 * Launches the voice communication server.
 * Listens for incoming Socket.IO and PeerJS connections.
 */
server.listen(PORT, () => {
  console.log(`🚀 Voice server running on port ${PORT}`);
});
