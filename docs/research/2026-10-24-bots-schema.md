# Bots schema research

Checked on 2026-10-24 against official documentation and the installed Drizzle
types. Context7 lookup used `/drizzle-team/drizzle-orm-docs`, then the primary
sources linked below. This note records schema decisions; it is not evidence
that a database deployment or application workflow passed.

## Mapping the reference

| Field | Proposed PostgreSQL representation | Behavior |
| --- | --- | --- |
| `id` | `text`, primary key | Generate Nano ID on Drizzle insertion |
| `userId` | required `text`, ordinary index | External authentication identifier; multiple bots per user |
| `name` | required `text` | Bot display name |
| `avatar` | required `text` | Generate an independent Nano ID as the avatar seed |
| `job` | required `text` | Short description of the bot's purpose |
| `instructions` | nullable `text` | Optional instructions |
| `sandboxId` | nullable `text` | External sandbox identifier, supplied later |
| `createdAt` | required `timestamp with time zone` | Database default `now()` |

This mapping interprets the supplied screenshot. Requiring `createdAt` and using
timezone-aware timestamps are implementation choices, rather than additional
requirements visible in the screenshot.

## Verified API details

- Drizzle's `.primaryKey()` enforces uniqueness and non-null values;
  `.notNull()` rejects nulls. Optional columns remain nullable. This does not
  reject empty strings; input validation is a separate application concern.
  [Drizzle column types](https://orm.drizzle.team/docs/column-types)
- `.$defaultFn(() => nanoid())` runs in Drizzle at insert time. It does not
  create a PostgreSQL default or affect Drizzle Kit. Consequently, raw SQL
  writers must supply `id` and `avatar` themselves. Passing a callback avoids
  generating a single shared value while the schema module loads.
  [Drizzle defaults](https://orm.drizzle.team/docs/column-types#default-value)
- Nano ID's standard `nanoid()` produces a 21-character URL-friendly string.
  A separate call for `avatar` gives it an independent seed; no unique
  constraint is needed for this field.
  [Nano ID API](https://github.com/ai/nanoid#api)
- Use `(table) => [index("bots_user_id_idx").on(table.userId)]` for the table's
  extra configuration. An ordinary index allows repeated owner IDs. Foreign
  keys refer to database tables; because these identifiers belong to external
  services and no local parent tables are part of the requested model, omit
  `.references(...)`. That last choice is an inference from the model.
  [Drizzle indexes and foreign keys](https://orm.drizzle.team/docs/indexes-constraints)
- Prefer `text` where no length limit was requested. PostgreSQL documents no
  performance advantage for length-constrained `varchar`; such a constraint
  should express a real limit, not an invented optimization.
  [PostgreSQL character types](https://www.postgresql.org/docs/current/datatype-character.html)
- `timestamp("created_at", { withTimezone: true }).notNull().defaultNow()`
  creates a SQL `now()` default. Timezone-aware storage represents an instant;
  Drizzle's default date mode maps it to a JavaScript `Date`.
  [Drizzle timestamps](https://orm.drizzle.team/docs/column-types#timestamp)

## Applying the schema

Use the repository's required `npm run db:push` command, backed by
`drizzle-kit push`. Push introspects the configured database, compares the
declared schema, and applies SQL directly without generating migration files.
The necessary configuration is the PostgreSQL dialect, schema path, and
database credentials; an output directory is unnecessary for this workflow.
[Drizzle Kit push](https://orm.drizzle.team/docs/drizzle-kit-push)

The repository's clean-slate policy rules out migration generation, migration
execution, and compatibility backfills. Any prior migration scripts and README
instructions should be replaced with the push workflow when implementing this
schema. See [AGENTS.md](../../AGENTS.md).
