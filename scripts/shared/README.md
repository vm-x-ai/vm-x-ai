# Shared Logging Functions

This directory contains shared shell script utilities for consistent logging across all scripts in the project.

## Files

- `logging.sh` - Main logging functions module
- `README.md` - This documentation file

## Usage

To use the shared logging functions in your script, source the logging module at the beginning:

```bash
#!/usr/bin/env bash

# Source shared logging functions
source "$(dirname "$0")/shared/logging.sh"

# Now you can use all the logging functions
log_info "Your message here"
```

## Available Functions

### Basic Logging Functions

These functions provide simple logging with emoji indicators:

- `log_info(message)` - ℹ️ Info message
- `log_success(message)` - ✅ Success message
- `log_error(message)` - ❌ Error message
- `log_warning(message)` - 🚨 Warning message
- `log_rocket(message)` - 🚀 Rocket message (for completion/launch)
- `log_gear(message)` - ⚙️ Gear message (for configuration/setup)

### Colored Logging Functions

These functions add color to the output:

- `log_info_colored(message)` - Blue info message
- `log_success_colored(message)` - Green success message
- `log_error_colored(message)` - Red error message
- `log_warning_colored(message)` - Yellow warning message
- `log_rocket_colored(message)` - Cyan rocket message
- `log_gear_colored(message)` - Blue gear message

### Bold Logging Functions

These functions make the text bold:

- `log_info_bold(message)` - Bold info message
- `log_success_bold(message)` - Bold green success message
- `log_error_bold(message)` - Bold red error message
- `log_warning_bold(message)` - Bold yellow warning message
- `log_rocket_bold(message)` - Bold cyan rocket message
- `log_gear_bold(message)` - Bold blue gear message

### Inline Bold Text Functions

These functions allow you to use `**text**` for bold formatting within messages:

- `log_info_bold_inline(message)` - Info message with inline bold text
- `log_success_bold_inline(message)` - Success message with inline bold text
- `log_error_bold_inline(message)` - Error message with inline bold text
- `log_warning_bold_inline(message)` - Warning message with inline bold text
- `log_rocket_bold_inline(message)` - Rocket message with inline bold text
- `log_gear_bold_inline(message)` - Gear message with inline bold text

**Usage**:

```bash
log_info_bold_inline "Installing **important** component"
log_success_bold_inline "Successfully connected to **production** database"
log_error_bold_inline "Failed to start **critical** service"
log_warning_bold_inline "**Deprecated** feature will be removed soon"
```

### Section Headers

These functions create visual section separators:

- `log_section(title)` - Creates a major section header with === borders
- `log_subsection(title)` - Creates a minor section header with --- borders

### Progress Indicators

These functions are useful for showing progress:

- `log_progress(message)` - Shows "message..." (for starting a process)
- `log_progress_success(message)` - Shows "✅ message completed"
- `log_progress_error(message)` - Shows "❌ message failed"

### Utility Functions

- `log_separator()` - Prints a line of dashes
- `log_newline()` - Prints an empty line

### Prompt Functions (No Line Break)

These functions are useful for user input prompts that don't add a line break:

- `log_prompt(message)` - Simple prompt without line break
- `log_prompt_bold_inline(message)` - Prompt with inline bold text (no line break)

**Usage**:

```bash
log_prompt_bold_inline "Enter your domain [**example.com**]: "
read DOMAIN
```

## Examples

```bash
#!/usr/bin/env bash
source "$(dirname "$0")/shared/logging.sh"

log_section "Starting Installation"

log_info "Checking prerequisites..."
if command -v docker &>/dev/null; then
    log_success "Docker is installed"
else
    log_error "Docker is not installed"
    exit 1
fi

log_subsection "Installing Components"
log_progress "Installing component A"
# ... installation code ...
log_progress_success "Component A installed"

log_progress "Installing component B"
# ... installation code ...
log_progress_error "Component B failed to install"

log_rocket "Installation process completed!"

# Example with inline bold text
log_info_bold_inline "Installing **critical** system component"
log_warning_bold_inline "**Deprecated** feature will be removed in next version"
log_success_bold_inline "Successfully connected to **production** database"
```

## Benefits

1. **Consistency** - All scripts use the same logging style
2. **Readability** - Emoji and colors make output easier to scan
3. **Maintainability** - Centralized logging logic
4. **Flexibility** - Multiple logging levels and styles available
5. **Reusability** - Easy to include in any script

## Migration

To migrate existing scripts:

1. Add the source line at the top of your script
2. Replace `echo -e "$INFO message"` with `log_info "message"`
3. Replace `echo -e "$CHECK message"` with `log_success "message"`
4. Replace `echo -e "$WARN message"` with `log_warning "message"`
5. Replace `echo -e "$CROSS message"` with `log_error "message"`
6. Replace `echo -e "$ROCKET message"` with `log_rocket "message"`
7. Replace `echo -e "$GEAR message"` with `log_gear "message"`
8. Replace `echo` with `log_newline`
9. Remove the emoji and color variable definitions from your script
