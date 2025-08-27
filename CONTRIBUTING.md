# Contributing to Mongeese CLI

Thank you for your interest in contributing to Mongeese CLI! This document provides guidelines and information for contributors.

## 🚀 Quick Start

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/mongeese-cli.git`
3. **Install** dependencies: `npm install`
4. **Build** the project: `npm run build`
5. **Test locally**: `npm link` (to test CLI globally)
6. **Start** developing!

## 📁 Project Structure

```
mongeese-cli/
├── src/
│   ├── bin/                    # CLI entry point
│   │   └── mongeese.ts         # Main CLI program with Commander.js
│   ├── commands/               # CLI command implementations
│   │   ├── init.ts             # Initialize project with connection file
│   │   ├── generate.ts         # Generate migration files
│   │   └── migrate.ts          # Apply/rollback migrations
│   ├── core/                   # Core business logic
│   │   ├── store.ts            # Migration tracking & database operations
│   │   ├── snapshot.ts         # Database schema snapshot generation
│   │   ├── detection.ts        # Mongoose model detection & analysis
│   │   ├── nestjs-detection.ts # NestJS <> Mongoose model detection & analysis
│   │   ├── diff.ts             # Schema comparison & change detection
│   │   ├── generate.ts         # Migration file generation
│   │   └── migration.ts        # Migration execution logic
│   ├── utilities/              # Helper functions
│   │   ├── detect-project-type.ts    # TypeScript vs JavaScript detection
│   │   ├── get-database.ts           # Database connection management
│   │   └── [other utilities]
│   └── types.d.ts            # TypeScript type definitions
├── dist/                     # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── README.md
```

## 🛠 Development Setup

### Prerequisites

- **Node.js** >= 16.0.0
- **npm** or **yarn**
- **MongoDB** instance (for testing)
- **Mongoose** >= 7 (for testing with Mongoose projects)

### Installation

```bash
git clone https://github.com/michael-nwuju/mongeese-cli.git
cd mongeese-cli
npm install
```

### Local Development

```bash
# Build the project
npm run build

# Link for global testing
npm link

# Now you can test CLI commands globally
mongeese --help
mongeese init
```

### Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run in development mode with watch
- `npm run prepublishOnly` - Build before publishing
- `npm test` - Run tests (when implemented)

## 🏗 Architecture Overview

### Core Workflow

Mongeese CLI works by:

1. **On-demand comparison** - Compares live database structure with Mongoose model definitions
2. **Change detection** - Identifies differences in collections, fields, indexes, and validators
3. **Migration generation** - Creates timestamped migration files with up/down commands
4. **Safe execution** - Applies migrations with transaction support and rollback capability

### Key Components

#### CLI Commands (`src/commands/`)

- **`init.ts`** - Creates `mongeese.connection.{ts|js}` file for database setup
- **`generate.ts`** - Detects schema changes and generates migration files
- **`migrate.ts`** - Applies migrations (`up`), rollbacks (`down`), or shows `status`

#### Core Logic (`src/core/`)

- **`store.ts` (MigrationStore)** - Manages migration metadata in `mongeese_migrations` collection
- **`snapshot.ts`** - Generates database schema snapshots by sampling collections
- **`detection.ts`** - Analyzes Mongoose models from codebase (supports NestJS)
- **`diff.ts`** - Compares snapshots to detect schema changes
- **`generate.ts`** - Creates migration files with MongoDB commands
- **`migration.ts`** - Executes up/down migrations with transaction support

#### Type System (`src/types.d.ts`)

Comprehensive TypeScript definitions for:

- **Snapshot structures** - Collections, fields, indexes, validators
- **Migration formats** - Commands, metadata, execution tracking
- **Configuration options** - NestJS support, model detection settings
- **Database interfaces** - `DbWithClient` for transaction support

### Database Integration

#### Connection Management

- Supports both **Mongoose** and **native MongoDB** connections
- Requires `DbWithClient` interface for transaction support
- Auto-detects project type (TypeScript/JavaScript) for template generation

#### Schema Detection

- **Database sampling** - Analyzes existing collections and documents
- **Mongoose model parsing** - Extracts schema definitions from code
- **NestJS support** - Special handling for NestJS schema files and bootstrapping
- **Field analysis** - Detects types, nullability, defaults, and nested structures

#### Migration Storage

- **`mongeese_migrations`** collection stores applied migrations
- **Timestamped filenames** for chronological ordering
- **Up/Down commands** for bidirectional migrations
- **Execution metadata** - timing, status, rollback information

## 🧪 Testing Strategy

### Current State

Tests are not yet implemented. Priority areas for testing:

### Integration Tests

- Database connection and sampling
- Mongoose model detection (vanilla and NestJS)
- Migration generation and execution
- Rollback functionality

### Unit Tests

- Schema diffing logic
- Command generation
- Field type detection
- Configuration parsing

### Testing Setup (Future)

```bash
# Example test structure
tests/
├── integration/
│   ├── mongoose-detection.test.ts
│   ├── migration-execution.test.ts
│   └── nestjs-integration.test.ts
├── unit/
│   ├── diff.test.ts
│   ├── snapshot.test.ts
│   └── store.test.ts
└── fixtures/
    ├── sample-schemas/
    └── sample-databases/
```

## 📝 Code Style & Standards

### TypeScript Guidelines

- **Strict mode enabled** - No `any` types, proper null checks
- **Comprehensive interfaces** - All data structures properly typed
- **Meaningful names** - Clear, descriptive variable and function names
- **JSDoc comments** - For public APIs and complex logic
- **Error handling** - Proper try-catch with meaningful error messages

### File Organization

- **kebab-case** for files: `generate-migration.ts`
- **PascalCase** for classes: `MigrationStore`, `SnapshotGenerator`
- **camelCase** for functions: `generateSnapshot`, `diffSnapshots`
- **SCREAMING_SNAKE_CASE** for constants: `DEFAULT_TIMEOUT`

### Code Patterns

- **Early returns** to reduce nesting
- **Async/await** over Promises for readability
- **Functional approach** where appropriate
- **Immutable operations** when possible
- **Graceful degradation** with fallbacks

### CLI Best Practices

- **Commander.js** patterns for consistent option handling
- **Chalk** for colored output and better UX
- **Progress indicators** for long-running operations
- **Clear error messages** with actionable suggestions
- **Dry-run options** for safe testing

## 🐛 Bug Reports

Please include:

### Environment Details

- Node.js version (`node --version`)
- Operating system
- MongoDB version
- Mongoose version (if applicable)
- Project type (NestJS, vanilla Node.js, etc.)

### Reproduction Steps

1. Clear step-by-step instructions
2. Sample Mongoose schemas (if relevant)
3. Database state before/after
4. Exact commands run

### Expected vs Actual

- What you expected to happen
- What actually happened
- Screenshots/logs if helpful

### Error Information

- Full stack traces
- Console output from `--verbose` mode (if available)
- Generated migration files (if relevant)

## 💡 Feature Requests

### Good Feature Requests Include:

1. **Problem description** - What pain point does this solve?
2. **Use case examples** - Real-world scenarios
3. **Proposed solution** - How might it work?
4. **Alternatives considered** - Other approaches you've thought about
5. **Breaking changes** - Would this affect existing users?

### Current Feature Priorities:

- Enhanced NestJS integration
- Custom field type detection
- Migration template customization
- Rollback safety improvements
- Performance optimizations for large schemas

## 🔄 Pull Request Process

### Before Submitting

1. **Create feature branch** from `main`
2. **Follow code style** guidelines
3. **Add/update types** in `types.d.ts` if needed
4. **Test thoroughly** with different project types
5. **Update documentation** (README, inline comments)

### PR Requirements

- **Clear title** and description
- **Reference issues** if applicable
- **Single responsibility** - one feature/fix per PR
- **Breaking changes** clearly documented
- **Migration compatibility** considered

### Review Process

- Code review by maintainers
- Automated checks (linting, building)
- Integration testing (manual for now)
- Documentation review

## 📋 Issue Labels

- `bug` - Something isn't working correctly
- `enhancement` - New feature or improvement
- `documentation` - README, comments, guides
- `good first issue` - Beginner-friendly
- `help wanted` - Community input needed
- `breaking change` - Affects existing functionality
- `nestjs` - NestJS-specific issues
- `performance` - Speed/memory optimizations

## 🤝 Community Guidelines

- **Be respectful** and inclusive to all contributors
- **Provide constructive feedback** in reviews
- **Help newcomers** understand the codebase
- **Share knowledge** about MongoDB/Mongoose best practices
- **Test thoroughly** before submitting changes

## 📞 Getting Help

- **GitHub Issues** - Bug reports and feature requests
- **GitHub Discussions** - Questions, ideas, and general help
- **Code Comments** - Inline documentation explains complex logic
- **README Examples** - Usage patterns and workflows

## 📄 License

By contributing to Mongeese CLI, you agree that your contributions will be licensed under the same license as the project (MIT).

---

Thank you for contributing to Mongeese CLI! Your help makes database migrations easier for the MongoDB community. 🚀
