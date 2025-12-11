#!/usr/bin/env bash

# Shared logging utilities for shell scripts
# This script provides consistent logging functions across all scripts

# Define emoji variables for use in output messages
CHECK="\xE2\x9C\x85"
CROSS="\xE2\x9D\x8C"
INFO="\xE2\x84\xB9\xEF\xB8\x8F"
WARN="\xF0\x9F\x9A\xA8"
ROCKET="\xF0\x9F\x9A\x80"
GEAR="\xE2\x9A\x99\xEF\xB8\x8F"

# Define color and style helpers for output formatting
BOLD="\033[1m"
RESET="\033[0m"
BLUE="\033[34m"
YELLOW="\033[33m"
RED="\033[31m"
GREEN="\033[32m"
CYAN="\033[36m"

# Logging functions
log_info() {
    echo -e "$INFO  $1"
}

log_success() {
    echo -e "$CHECK $1"
}

log_error() {
    echo -e "$CROSS $1"
}

log_warning() {
    echo -e "$WARN $1"
}

log_rocket() {
    echo -e "$ROCKET $1"
}

log_gear() {
    echo -e "$GEAR  $1"
}

# Colored logging functions
log_info_colored() {
    echo -e "$INFO  ${BLUE}$1${RESET}"
}

log_success_colored() {
    echo -e "$CHECK ${GREEN}$1${RESET}"
}

log_error_colored() {
    echo -e "$CROSS ${RED}$1${RESET}"
}

log_warning_colored() {
    echo -e "$WARN ${YELLOW}$1${RESET}"
}

log_rocket_colored() {
    echo -e "$ROCKET ${CYAN}$1${RESET}"
}

log_gear_colored() {
    echo -e "$GEAR  ${BLUE}$1${RESET}"
}

# Bold text functions
log_info_bold() {
    echo -e "$INFO  ${BOLD}$1${RESET}"
}

log_success_bold() {
    echo -e "$CHECK ${BOLD}${GREEN}$1${RESET}"
}

log_error_bold() {
    echo -e "$CROSS ${BOLD}${RED}$1${RESET}"
}

log_warning_bold() {
    echo -e "$WARN ${BOLD}${YELLOW}$1${RESET}"
}

log_rocket_bold() {
    echo -e "$ROCKET ${BOLD}${CYAN}$1${RESET}"
}

log_gear_bold() {
    echo -e "$GEAR  ${BOLD}${BLUE}$1${RESET}"
}

# Section header functions
log_section() {
    echo
    echo -e "${BOLD}${CYAN}=== $1 ===${RESET}"
    echo
}

log_subsection() {
    echo
    echo -e "${BOLD}${BLUE}--- $1 ---${RESET}"
}

# Progress indicator functions
log_progress() {
    echo -e "$INFO  $1..."
}

log_progress_success() {
    echo -e "$CHECK $1 completed"
}

log_progress_error() {
    echo -e "$CROSS $1 failed"
}

# Inline bold text functions
# These functions allow you to use **text** for bold formatting within messages
log_info_bold_inline() {
    local message="$1"
    # Replace **text** with bold formatting
    message=$(echo "$message" | sed 's/\*\*\([^*]*\)\*\*/\\033[1m\1\\033[0m/g')
    echo -e "$INFO  $message"
}

log_success_bold_inline() {
    local message="$1"
    # Replace **text** with bold formatting
    message=$(echo "$message" | sed 's/\*\*\([^*]*\)\*\*/\\033[1m\\033[32m\1\\033[0m/g')
    echo -e "$CHECK $message"
}

log_error_bold_inline() {
    local message="$1"
    # Replace **text** with bold formatting
    message=$(echo "$message" | sed 's/\*\*\([^*]*\)\*\*/\\033[1m\\033[31m\1\\033[0m/g')
    echo -e "$CROSS $message"
}

log_warning_bold_inline() {
    local message="$1"
    # Replace **text** with bold formatting
    message=$(echo "$message" | sed 's/\*\*\([^*]*\)\*\*/\\033[1m\\033[33m\1\\033[0m/g')
    echo -e "$WARN $message"
}

log_rocket_bold_inline() {
    local message="$1"
    # Replace **text** with bold formatting
    message=$(echo "$message" | sed 's/\*\*\([^*]*\)\*\*/\\033[1m\\033[36m\1\\033[0m/g')
    echo -e "$ROCKET $message"
}

log_gear_bold_inline() {
    local message="$1"
    # Replace **text** with bold formatting
    message=$(echo "$message" | sed 's/\*\*\([^*]*\)\*\*/\\033[1m\\033[34m\1\\033[0m/g')
    echo -e "$GEAR  $message"
}

# Utility functions
log_separator() {
    echo "----------------------------------------"
}

log_newline() {
    echo
}

# Prompt functions (no line break)
log_prompt() {
    echo -n "$1"
}

log_prompt_bold_inline() {
    local message="$1"
    # Replace **text** with bold formatting
    message=$(echo "$message" | sed 's/\*\*\([^*]*\)\*\*/\\033[1m\\033[34m\1\\033[0m/g')
    echo -e -n "$message"
}

# Export functions so they can be used by other scripts
export -f log_info log_success log_error log_warning log_rocket log_gear
export -f log_info_colored log_success_colored log_error_colored log_warning_colored log_rocket_colored log_gear_colored
export -f log_info_bold log_success_bold log_error_bold log_warning_bold log_rocket_bold log_gear_bold
export -f log_info_bold_inline log_success_bold_inline log_error_bold_inline log_warning_bold_inline log_rocket_bold_inline log_gear_bold_inline
export -f log_section log_subsection log_progress log_progress_success log_progress_error
export -f log_separator log_newline log_prompt log_prompt_bold_inline 