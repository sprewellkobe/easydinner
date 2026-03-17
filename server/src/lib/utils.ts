import { nanoid } from 'nanoid';

export function generateId(): string {
  return nanoid(10);
}

export function generateParticipantId(): string {
  return nanoid(8);
}


