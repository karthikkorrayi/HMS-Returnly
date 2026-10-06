import { ROOM_STATUS_LABEL, type RoomStatus } from '@/lib/types'

export const ROOM_STATUS_STYLE: Record<RoomStatus, string> = {
  occupied: 'bg-teal-soft text-teal-dark',
  due_out: 'bg-paper text-ink border border-line',
  needs_check: 'bg-attention-soft text-attention',
  check_overdue: 'bg-danger text-white',
  ready: 'bg-done-soft text-done',
}

export default function RoomStatusBadge({ status }: { status: RoomStatus }) {
  return <span className={`badge ${ROOM_STATUS_STYLE[status]}`}>{ROOM_STATUS_LABEL[status]}</span>
}
