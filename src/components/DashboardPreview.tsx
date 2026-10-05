import ItemDashboard from './ItemDashboard'
import {
  DASHBOARD_VIEWS,
  matchesDashboardFilter,
  type DashboardCounts,
  type DashboardItem,
} from '@/lib/item-dashboard'

const SAMPLE_ITEMS: DashboardItem[] = [
  {
    id: 'sample-001', code: 'SAMPLE-001', description: 'Wireless headphones',
    category: 'Electronics', location: 'Room 204',
    status: 'logged', tier: 'valuable', retention: false,
  },
  {
    id: 'sample-002', code: 'SAMPLE-002', description: 'Blue linen shirt',
    category: 'Clothing', location: 'Room 118',
    status: 'awaiting_collection', tier: 'standard', retention: false,
  },
  {
    id: 'sample-003', code: 'SAMPLE-003', description: 'Passport',
    category: 'Documents & cards', location: 'Lobby',
    status: 'logged', tier: 'sensitive', retention: false,
  },
  {
    id: 'sample-004', code: 'SAMPLE-004', description: 'Travel charger',
    category: 'Chargers & cables', location: 'Room 302',
    status: 'stored', tier: 'standard', retention: true,
  },
  {
    id: 'sample-005', code: 'SAMPLE-005', description: 'Silver wristwatch',
    category: 'Jewellery & watches', location: 'Restaurant',
    status: 'awaiting_shipping', tier: 'valuable', retention: false,
  },
  {
    id: 'sample-006', code: 'SAMPLE-006', description: 'Canvas tote bag',
    category: 'Bags', location: 'Room 216',
    status: 'matched', tier: 'standard', retention: false,
  },
  {
    id: 'sample-007', code: 'SAMPLE-007', description: 'Children’s storybook',
    category: 'Books', location: 'Lobby',
    status: 'returned', tier: 'standard', retention: false,
  },
]

export default function DashboardPreview() {
  const counts = Object.fromEntries(
    DASHBOARD_VIEWS.map(({ id }) => [
      id,
      SAMPLE_ITEMS.filter((item) => matchesDashboardFilter(item, id)).length,
    ])
  ) as DashboardCounts

  return <ItemDashboard mode="preview" items={SAMPLE_ITEMS} counts={counts} />
}
