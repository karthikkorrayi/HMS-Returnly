// How values come back from Postgres, so pages get plain, predictable values:
//   date         → 'YYYY-MM-DD' string. node-postgres would otherwise make a
//                  JavaScript Date at LOCAL midnight, which shifts the day in
//                  some time zones (e.g. 2026-10-24 becomes 2026-10-23T18:30Z
//                  on a server in India).
//   timestamptz  → ISO 8601 string in UTC, e.g. '2026-10-24T09:30:00.123Z'.
//   timestamp    → left as text (the schema uses timestamptz throughout).
// Numbers: int4 → number (default); bigint and numeric stay strings to avoid
// losing precision, so cast counts with ::int in SQL.
import pg from 'pg'

const DATE = 1082
const TIMESTAMP = 1114
const TIMESTAMPTZ = 1184
const DATE_ARRAY = 1182
const TIMESTAMPTZ_ARRAY = 1185

const defaultTimestamptz = pg.types.getTypeParser(TIMESTAMPTZ, 'text') as (v: string) => Date

export const returnlyTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (format === 'binary') return pg.types.getTypeParser(oid, format)
    switch (oid) {
      case DATE:
      case TIMESTAMP:
        return (v: string) => v
      case TIMESTAMPTZ:
        return (v: string) => defaultTimestamptz(v).toISOString()
      case DATE_ARRAY:
      case TIMESTAMPTZ_ARRAY:
        // Not used by the app; refuse to guess rather than mis-convert silently.
        return (v: string) => v
      default:
        return pg.types.getTypeParser(oid, 'text')
    }
  },
} as pg.CustomTypesConfig
