# 🧬 Mongeese CLI

> Auto-generate MongoDB migration scripts by detecting changes in your Mongoose schemas.

**Mongeese CLI** is a CLI tool that tracks your Mongoose models, detects schema changes, and generates versioned MongoDB migration files — just like TypeORM or Prisma, but built for MongoDB's schemaless world.

---

## 📦 Installation

Install globally with npm:

```bash
npm install -g mongeese-cli
```

Or with yarn:

```bash
yarn global add mongeese-cli
```

Or use npx (no install required):

```bash
npx mongeese-cli <command>
```

---

## ⚡ Quick Start

```bash
npx mongeese-cli init                   # Sets up migration tracking
npx mongeese-cli generate               # Detects changes and generates migration
npx mongeese-cli migrate up             # Applies pending migrations
npx mongeese-cli migrate status         # Shows migration status
```

---

## 🛠 Commands

### `mongeese init`

Initialize Mongeese in your project. This creates a connection configuration file.

```bash
mongeese init
```

### `mongeese generate [options]`

Generate a migration file by comparing your current Mongoose schemas with the database state.

```bash
mongeese generate                           # Auto-generate migration
mongeese generate --name add_user_fields    # Generate with custom name
mongeese generate -n create_indexes         # Short form
```

**Options:**

- `-n, --name <name>` - Custom name for the migration file

### `mongeese migrate [direction] [options]`

Apply, rollback, or show status of migrations.

```bash
mongeese migrate                            # Show migration status (default)
mongeese migrate status                     # Show migration status
mongeese migrate up                         # Apply all pending migrations
mongeese migrate down                       # Rollback last migration
mongeese migrate down --target 20240501_120000_add_users  # Rollback to specific migration
```

**Options:**

- `-t, --target <target>` - Target migration filename or timestamp

---

## 🧠 Why Use Mongeese CLI?

✅ **Eliminate manual migration scripts** - Auto-generate migrations from schema changes

🛡 **Prevent silent schema drift** - Track all changes between code and database

🚀 **Speed up development** - Works seamlessly with NestJS and Mongoose projects

🔁 **Safe rollbacks** - Generate both up and down migration commands

🧩 **CI/CD friendly** - Version-controlled migration files for deployment pipelines

---

## 📋 How It Works

1. **Initialize**: Run `mongeese init` to set up your database connection
2. **Develop**: Make changes to your Mongoose schemas as usual
3. **Generate**: Run `mongeese generate` to create a migration file
4. **Review**: Check the generated migration commands
5. **Apply**: Run `mongeese migrate up` to execute the migration
6. **Deploy**: Commit migration files and run in other environments

The CLI compares your current Mongoose model definitions with the actual database structure to detect changes, then generates appropriate MongoDB commands to sync them.

---

## 🔧 Configuration

After running `mongeese init`, edit the generated connection file:

**TypeScript projects:**

```typescript
// mongeese.connection.ts
export async function getDbWithClient(dbName?: string): Promise<DbWithClient> {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(dbName);
  (db as DbWithClient).client = client;
  return db as DbWithClient;
}
```

**JavaScript projects:**

```javascript
// mongeese.connection.js
export async function getDbWithClient(dbName) {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(dbName);
  db.client = client;
  return db;
}
```

Make sure to set your `MONGODB_URI` environment variable.

---

## 🛠 Requirements

- **Node.js** >= 16
- **Mongoose** >= 7
- **MongoDB** connection
- Works great with **NestJS**, but framework-agnostic

---

## 📝 Example Workflow

```bash
# 1. Initialize in your project (add your Mongo Connection URI)
mongeese init

# 2. Make changes to your Mongoose schemas
# (add fields, modify types, create new models, etc.)

# 3. Generate migration
mongeese generate --name add_user_preferences

# 4. Review the generated migration file
# migrations/20240825_143022_add_user_preferences.js

# 5. Apply the migration
mongeese migrate up

# 6. Check status
mongeese migrate status
```

---

## ⚠️ Important Notes

- Always review generated migrations before applying them
- Test migrations in a development environment first
- Keep migration files in version control
- Mongeese compares live database state with your code, so ensure your database is accessible
- The tool works by analyzing both your Mongoose model files and current database collections

---

## 🤝 Contributing

We welcome issues, feedback, and PRs!

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get started.

---

## 📄 License

[MIT License](./LICENSE)
