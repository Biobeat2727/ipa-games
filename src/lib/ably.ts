import Ably from 'ably'

export const ablyClient = new Ably.Realtime({
  key: import.meta.env.VITE_ABLY_KEY,
  clientId: crypto.randomUUID(),
})
