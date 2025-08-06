# 🧬 Mongeese

> Auto-generate MongoDB migration scripts by detecting changes in your Mongoose schemas.

**Mongeese** is a CLI tool that tracks your Mongoose models, detects schema changes, and generates versioned MongoDB migration files — just like TypeORM or Prisma, but built for MongoDB’s schemaless world.

---

## 📦 Installation

Install globally with npm:

```bash
npm install -g mongeese
```

Or with yarn:

```bash
yarn global add mongeese
```

Or use npx (no install required):

```bash
npx mongeese <command>
```

---

## ⚡ Quick Start

```bash
npx mongeese init       # Sets up migration tracking
npx mongeese diff       # Detects schema changes
npx mongeese generate   # Generates a migration file
npx mongeese apply      # Runs the migration
```

---

## 🛠 Usage

After installation, use the CLI:

```bash
mongeese init
mongeese generate --name add_users_collection
mongeese migrate up
mongeese migrate down --target 20240501_120000_add_users_collection
mongeese migrate status
```

---

## 🧠 Why Use Mongeese?

✅ Eliminate manual migration scripts

🛡 Prevent silent schema drift in production

🚀 Speed up development in NestJS / Mongoose projects

🔁 Track changes and roll them back if needed

🧩 CI/CD and GitOps friendly

---

## 📦 Features

- 📸 Snapshot Mongoose schemas on every change

- 🧬 Detect added/removed/modified fields

- 🛠 Generate $set, $unset, and rollback scripts

- 🗂 Organize migrations by timestamp

---

## 🛠 Requirements

Node.js >= 18

Mongoose >= 7

Works great with NestJS, but framework-agnostic

## 🤝 Contributing

We welcome issues, feedback, and PRs.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to get started.
