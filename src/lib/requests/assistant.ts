// The enquiry conversation, as a pure state machine.
//
// This is the seam for a future chatbot: an AI-backed assistant would
// implement the same EnquiryAssistant interface (start / respond) and must
// still end in an EnquiryPayload the customer reviews before sending. It must
// never see item records — matching happens server-side, for staff only.

import { CATEGORIES } from '@/lib/types'
import { extractDetails } from './extract'

export type Draft = {
  itemName: string
  description: string
  category: string | null
  colour: string | null
  brand: string | null
  lostLocation: string | null
  lostDate: string | null // YYYY-MM-DD
}

export type Step = 'describe' | 'category' | 'location' | 'date' | 'review'

export type ChatMessage = { id: number; from: 'assistant' | 'customer'; text: string }

export type QuickReply = { label: string; value: string }

export type ConversationState = {
  step: Step
  draft: Draft
  messages: ChatMessage[]
  quickReplies: QuickReply[]
  // What the input area should offer for this step.
  input: 'text' | 'choices' | 'date' | 'none'
}

export type CustomerInput = { kind: 'text'; text: string } | { kind: 'choice'; value: string; label: string }

export interface EnquiryAssistant {
  start(today: string): ConversationState
  respond(state: ConversationState, input: CustomerInput, today: string): ConversationState
}

const emptyDraft: Draft = {
  itemName: '',
  description: '',
  category: null,
  colour: null,
  brand: null,
  lostLocation: null,
  lostDate: null,
}

const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]))

function addDays(today: string, n: number) {
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function say(state: ConversationState, from: ChatMessage['from'], ...texts: string[]): ChatMessage[] {
  let id = state.messages.at(-1)?.id ?? 0
  return [...state.messages, ...texts.map((text) => ({ id: ++id, from, text }))]
}

function locationStep(s: ConversationState, suggested: string | null): ConversationState {
  const base: QuickReply[] = [
    { label: 'In my room', value: 'Guest room' },
    { label: 'Restaurant or bar', value: 'Restaurant / bar' },
    { label: 'Lobby / reception', value: 'Lobby / reception' },
    { label: 'Gym, pool or spa', value: 'Gym, pool or spa' },
    { label: 'Not sure', value: '' },
  ]
  const replies = suggested && !base.some((b) => b.value === suggested)
    ? [{ label: suggested, value: suggested }, ...base]
    : base
  return {
    ...s,
    step: 'location',
    messages: say(s, 'assistant', 'Where do you think you left it? Pick one or type it.'),
    quickReplies: replies,
    input: 'text',
  }
}

function dateStep(s: ConversationState, today: string): ConversationState {
  return {
    ...s,
    step: 'date',
    messages: say(s, 'assistant', 'Roughly when did you last have it?'),
    quickReplies: [
      { label: 'Today', value: today },
      { label: 'Yesterday', value: addDays(today, -1) },
      { label: '2–3 days ago', value: addDays(today, -2) },
      { label: 'Not sure', value: '' },
    ],
    input: 'date',
  }
}

function reviewStep(s: ConversationState): ConversationState {
  return {
    ...s,
    step: 'review',
    messages: say(
      s,
      'assistant',
      'Thanks. Check the details below — you can change anything — then send your enquiry.'
    ),
    quickReplies: [],
    input: 'none',
  }
}

export const ruleBasedAssistant: EnquiryAssistant = {
  start() {
    return {
      step: 'describe',
      draft: emptyDraft,
      messages: [
        {
          id: 1,
          from: 'assistant',
          text: 'Hello. I’ll help you send a lost property enquiry to the hotel. This is a guided form, not a live chat — a member of staff reviews every enquiry.',
        },
        {
          id: 2,
          from: 'assistant',
          text: 'What did you lose? Describe it in your own words — colour, brand, and anything that makes it yours.',
        },
      ],
      quickReplies: [],
      input: 'text',
    }
  },

  respond(state, input, today) {
    const text = input.kind === 'text' ? input.text.trim() : input.value
    const shown = input.kind === 'text' ? input.text.trim() : input.label
    let s: ConversationState = { ...state, messages: say(state, 'customer', shown || 'Not sure') }

    switch (state.step) {
      case 'describe': {
        if (text.length < 3) {
          return { ...s, messages: say(s, 'assistant', 'Could you describe it in a few more words?') }
        }
        const found = extractDetails(text)
        s = {
          ...s,
          draft: {
            ...s.draft,
            description: text.slice(0, 1000),
            itemName: found.itemName ?? '',
            category: found.category,
            colour: found.colour,
            brand: found.brand,
          },
        }
        const noted = [found.itemName, found.colour, found.brand].filter(Boolean)
        if (noted.length) s = { ...s, messages: say(s, 'assistant', `I’ve noted: ${noted.join(' · ')}.`) }
        if (!found.category) {
          return {
            ...s,
            step: 'category',
            messages: say(s, 'assistant', 'Which of these is closest?'),
            quickReplies: CATEGORIES.map((c) => ({ label: c.label, value: c.value })),
            input: 'choices',
          }
        }
        return locationStep(s, found.location)
      }

      case 'category': {
        const category = CATEGORY_LABEL[text] ? text : 'other'
        s = {
          ...s,
          draft: { ...s.draft, category, itemName: s.draft.itemName || CATEGORY_LABEL[category] },
        }
        return locationStep(s, extractDetails(s.draft.description).location)
      }

      case 'location':
        return dateStep({ ...s, draft: { ...s.draft, lostLocation: text ? text.slice(0, 80) : null } }, today)

      case 'date': {
        const valid = /^\d{4}-\d{2}-\d{2}$/.test(text) && text <= today && text >= addDays(today, -365)
        if (text && !valid) {
          return { ...s, messages: say(s, 'assistant', 'Please pick a date within the last year, or choose “Not sure”.') }
        }
        return reviewStep({ ...s, draft: { ...s.draft, lostDate: text || null } })
      }

      default:
        return s
    }
  },
}
