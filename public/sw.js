// Service worker mínimo — não faz cache de nada de propósito (o app sempre
// busca dados frescos do Supabase). Ele existe só porque navegadores
// costumam exigir um service worker registrado pra considerar o site um
// "app instalável de verdade", categoria que o iOS trata com mais respeito
// de armazenamento do que um simples atalho salvo na Tela de Início.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', () => {
  // Intencionalmente vazio — deixa toda requisição passar direto pra rede.
})
