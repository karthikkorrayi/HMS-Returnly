export type SupportTopic =
  | 'start'
  | 'lost'
  | 'collection'
  | 'shipping'
  | 'sensitive'
  | 'contact'
export const supportTopics: Record<SupportTopic, string> = {
  start: 'Start again',
  lost: 'I lost something',
  collection: 'Collect an item',
  shipping: 'Arrange delivery',
  sensitive: 'ID, cards or medication',
  contact: 'Talk to the hotel',
}
export function supportMessage(topic: SupportTopic, name: string) {
  switch (topic) {
    case 'lost':
      return {
        text: `Let’s help ${name} check. Choose “Report a lost item” to use the hotel’s existing enquiry assistant. You’ll review the details before sending and receive a reference. Is your item an ID, card or medication?`,
        next: ['sensitive', 'contact', 'start'] as SupportTopic[],
      }
    case 'collection':
      return {
        text: 'Has the hotel confirmed ownership? Arrange a time with the team and bring identification that matches your booking. Check your existing enquiry for updates; a submitted enquiry alone does not confirm a match.',
        next: ['shipping', 'contact', 'start'] as SupportTopic[],
      }
    case 'shipping':
      return {
        text: 'Once staff confirm ownership, ask about delivery availability, cost, packaging and tracking. Arrangements depend on the hotel and item. This guide cannot book shipping or take payments.',
        next: ['contact', 'collection', 'start'] as SupportTopic[],
      }
    case 'sensitive':
      return {
        text: 'Contact the hotel promptly. Do not send passport or card numbers, document photos or medical details in this chat. For a missing bank card, contact your card issuer; for urgent medication needs, seek appropriate medical help.',
        next: ['contact', 'lost', 'start'] as SupportTopic[],
      }
    case 'contact':
      return {
        text: `Use the official contact details for ${name} below, or those on your booking confirmation. For an existing enquiry, open “Check an enquiry” with your reference and booking ID. Only hotel staff can check records and confirm ownership.`,
        next: ['lost', 'collection', 'start'] as SupportTopic[],
      }
    default:
      return {
        text: `Hello! I’m the guided support assistant for ${name}. I can help you report a lost item, follow an enquiry or plan a return. What would you like to do?`,
        next: ['lost', 'collection', 'shipping', 'contact'] as SupportTopic[],
      }
  }
}
export function detectSupportTopic(text: string): SupportTopic | null {
  if (/\b(passport|identity|medication|medicine|card|sensitive)\b/i.test(text))
    return 'sensitive'
  if (/\b(ship|shipping|delivery|post|courier)\b/i.test(text)) return 'shipping'
  if (/\b(collect|collection|pickup)\b/i.test(text)) return 'collection'
  if (/\b(contact|human|reception|desk|status|track)\b/i.test(text))
    return 'contact'
  if (/\b(lost|missing|left|forgot)\b/i.test(text)) return 'lost'
  if (/\b(hi|hello|start|reset)\b/i.test(text)) return 'start'
  return null
}
