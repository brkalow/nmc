# nmc - Node Modules Cleaner

CLI tool to find and clean `node_modules` directories. Shows size and age, with filtering and sorting options.

## Installation

```bash
bun install
bun run build
```

To install globally:

```bash
bun link
```

## Usage

```bash
# Scan current directory
nmc

# Scan specific directory
nmc ~/projects

# Only show directories older than 30 days
nmc --older 30

# Sort by size (largest first) instead of age
nmc --size

# Delete with confirmation
nmc --clean

# Delete without confirmation
nmc --clean --yes

# Delete dirs older than 90 days without prompting
nmc -o 90 -c -y
```

## Options

| Option               | Description                                 |
| -------------------- | ------------------------------------------- |
| `-c, --clean`        | Delete found directories                    |
| `-y, --yes`          | Skip confirmation prompt                    |
| `-o, --older <days>` | Only show directories older than N days     |
| `-s, --size`         | Sort by size (largest first) instead of age |
| `-h, --help`         | Show help message                           |

## Development

```bash
# Run in development mode
bun run dev

# Build for distribution
bun run build

# Run tests
bun test
```
