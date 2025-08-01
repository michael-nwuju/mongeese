# Contributing to Mongeese

Thank you for your interest in contributing to Mongeese! This document provides guidelines and information for contributors.

## 🚀 Quick Start

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/mongeese.git`
3. **Install** dependencies: `npm install`
4. **Build** the project: `npm run build`
5. **Start** developing: `npm run dev`

## 📁 Project Structure

```
mongeese/
├── src/
│   ├── bin/                    # CLI entry point
│   │   └── mongeese.ts
│   ├── commands/               # CLI commands
│   │   └── init.ts
│   ├── core/                   # Core business logic
│   │   └── store.ts           # Migration store management
│   ├── interfaces/             # TypeScript interfaces
│   │   └── snapshot.ts
│   ├── utilities/              # Helper functions
│   │   ├── detect-project-type.ts
│   │   ├── detect-mongoose-availability.ts
│   │   ├── flatten.ts
│   │   ├── extract-db.ts
│   │   └── detect-connection-type.ts
│   └── index.ts               # Main entry point
├── dist/                      # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── README.md
```

## 🛠 Development Setup

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- MongoDB instance (for testing)

### Installation

```bash
git clone https://github.com/michael-nwuju/mongeese.git
cd mongeese
npm install
```

### Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run CLI in development mode
- `npm run prepublishOnly` - Build before publishing

### Development Workflow

1. Make your changes in the `src/` directory
2. Run `npm run build` to compile
3. Test your changes with `npm run dev`
4. Ensure all tests pass (when implemented)

## 🧪 Testing

Currently, tests are not implemented. When adding new features:

1. Create test files in a `tests/` directory
2. Use a testing framework like Jest or Mocha
3. Test both the CLI and programmatic APIs
4. Include integration tests with a real MongoDB instance

## 📝 Code Style

### TypeScript Guidelines

- Use TypeScript strict mode
- Prefer interfaces over types for object shapes
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

### File Naming

- Use kebab-case for file names: `detect-project-type.ts`
- Use PascalCase for classes: `MigrationStore`
- Use camelCase for functions and variables: `generateSnapshot`

### Code Organization

- Keep functions small and focused
- Use early returns to reduce nesting
- Handle errors gracefully with try-catch blocks
- Use async/await for asynchronous operations

## 🔧 Architecture Overview

### Core Components

#### MigrationStore (`src/core/store.ts`)

Manages migration metadata and configuration in MongoDB collections:

- `mongeese-migrations` - Stores migration scripts and metadata
- `mongeese-config` - Stores configuration and initialization state

#### CLI Commands (`src/commands/`)

- `init.ts` - Creates bootstrap files for database connection
- Future commands: `diff.ts`, `generate.ts`, `apply.ts`

#### Utilities (`src/utilities/`)

- `detect-project-type.ts` - Detects TypeScript vs JavaScript projects
- `detect-mongoose-availability.ts` - Checks if Mongoose is available
- `flatten.ts` - Flattens nested objects to dot notation
- `extract-db.ts` - Extracts Db instance from connections
- `detect-connection-type.ts` - Detects Mongoose vs native MongoDB

### Connection Handling

Mongeese supports both Mongoose and native MongoDB connections:

- Automatically detects connection type
- Provides bootstrap templates for both approaches
- Extracts Db instances consistently

## 🐛 Bug Reports

When reporting bugs, please include:

1. **Environment details**:

   - Node.js version
   - Operating system
   - MongoDB version
   - Mongoose version (if applicable)

2. **Steps to reproduce**:

   - Clear, step-by-step instructions
   - Sample code or configuration

3. **Expected vs actual behavior**:

   - What you expected to happen
   - What actually happened

4. **Error messages**:
   - Full error stack traces
   - Console output

## 💡 Feature Requests

When suggesting features:

1. **Describe the problem** you're trying to solve
2. **Explain why** this feature would be useful
3. **Provide examples** of how it would work
4. **Consider alternatives** and trade-offs

## 🔄 Pull Request Process

1. **Create a feature branch** from `main`
2. **Make your changes** following the code style guidelines
3. **Test your changes** thoroughly
4. **Update documentation** if needed
5. **Submit a PR** with a clear description

### PR Guidelines

- Use descriptive commit messages
- Keep PRs focused on a single feature/fix
- Include tests for new functionality
- Update README.md if adding new features
- Reference related issues

## 📋 Issue Labels

- `bug` - Something isn't working
- `enhancement` - New feature or request
- `documentation` - Improvements to documentation
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention needed

## 🤝 Community Guidelines

- Be respectful and inclusive
- Help others learn and grow
- Provide constructive feedback
- Follow the project's code of conduct

## 📞 Getting Help

- **Issues**: Use GitHub issues for bugs and feature requests
- **Discussions**: Use GitHub discussions for questions and ideas
- **Documentation**: Check the README.md for usage examples

## 🎯 Roadmap

Current priorities:

1. Implement snapshot generation
2. Add diff detection between snapshots
3. Create migration script generation
4. Add migration application logic
5. Implement rollback functionality
6. Add comprehensive testing

## 📄 License

By contributing to Mongeese, you agree that your contributions will be licensed under the ISC License.

---

Thank you for contributing to Mongeese! 🚀
