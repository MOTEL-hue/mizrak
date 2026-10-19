# Manual Testing

## Operations Systems

The following Operation Systems are supported:

- Windows
- Linux
- MacOS (Apple Silicon)
- MacOS (Intel)

## Testing Steps

For each Operation System, the following steps should be followed:

- Open מזרק
- Add two bank accounts (no need to test every bank account)
- Configure the exporters
    - Excel
    - Google Sheets
    - JSON
    - YNAB
- Change the configurations (open browser, timeout, days back)
- Close מזרק completely (on MacOS, make sure it's not running in the background)
- Open מזרק
- [ ] Check if all the previous configurations are still there
