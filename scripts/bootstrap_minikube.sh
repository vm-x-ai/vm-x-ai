#!/usr/bin/env bash

# Keep sudo alive
sudo -v

# Exit immediately if a command exits with a non-zero status, treat unset variables as errors, and fail if any command in a pipeline fails
set -euo pipefail

# Source shared logging functions
source "$(dirname "$0")/shared/logging.sh"

# Check if minikube is installed
if ! command -v minikube &>/dev/null; then
  log_warning "Minikube not found. Please install it first."
  exit 1
fi

# Check if helm is installed
if ! command -v helm &>/dev/null; then
  log_warning "Helm not found. Please install it first."
  exit 1
fi

# Start minikube if it is not already running
if ! minikube status &>/dev/null; then
  if ! minikube start --cpus=8 --memory=8192 --driver=docker; then
    log_warning "Failed to start Minikube. Please check the logs and try again."
    exit 1
  fi

  log_success "Minikube started successfully"
fi

log_info "Enabling metrics-server"
if ! minikube addons enable metrics-server; then
  log_warning "Failed to enable metrics-server. Please check the logs and try again."
  exit 1
fi
log_success "metrics-server enabled successfully"

# Kill any existing minikube tunnel processes
if pgrep -f "minikube tunnel" > /dev/null; then
  log_warning "Killing existing minikube tunnel processes"
  pkill -f "minikube tunnel"
fi

log_info "Starting minikube tunnel"
MINIKUBE_TUNNEL_PID=$(minikube tunnel &>/dev/null & echo $!)
log_info "Minikube tunnel started successfully"

# Add and update Helm repositories for Istio, Temporal, and LocalStack
log_info "Updating Helm Repositories"
helm repo add istio https://istio-release.storage.googleapis.com/charts
helm repo update

# Set Istio version to install
ISTIO_VERSION=1.26.1

cleanup() {
  if [[ -n "$MINIKUBE_TUNNEL_PID" ]] && ps -p "$MINIKUBE_TUNNEL_PID" > /dev/null 2>&1; then
    kill "$MINIKUBE_TUNNEL_PID"
  fi
  exit 0
}

trap cleanup SIGINT SIGTERM

# Install Istio Base if not already installed
if ! helm status istio-base -n istio-system &>/dev/null; then
    log_info_bold "Installing Istio Base ${ISTIO_VERSION}"
    if ! helm install istio-base istio/base -n istio-system --version=${ISTIO_VERSION} --wait --create-namespace; then
        log_warning "Failed to install Istio Base. Please check the logs and try again."
        cleanup
        exit 1
    fi
    log_success "Istio Base installed successfully"
fi

# Install Istiod (Istio control plane) if not already installed
if ! helm status istiod -n istio-system &>/dev/null; then
    log_info_bold "Installing Istiod ${ISTIO_VERSION}"
    if ! helm install istiod istio/istiod -n istio-system --version=${ISTIO_VERSION} --wait; then
        log_warning "Failed to install Istiod. Please check the logs and try again."
        cleanup
        exit 1
    fi
    log_success "Istiod installed successfully"
fi

# Install Istio CNI (Container Network Interface) if not already installed
if ! helm status istio-cni -n istio-system &>/dev/null; then
    log_info_bold "Installing Istio CNI ${ISTIO_VERSION}"
    if ! helm install istio-cni istio/cni -n istio-system --version=${ISTIO_VERSION} --wait; then
        log_warning "Failed to install Istio CNI. Please check the logs and try again."
        cleanup
        exit 1
    fi
    log_success "Istio CNI installed successfully"
fi

# Install Istio Gateway (ingressgateway) if not already installed
if ! helm status ingressgateway -n istio-system &>/dev/null; then
    log_info_bold "Installing Istio Gateway ${ISTIO_VERSION}"
    if ! helm install ingressgateway istio/gateway -n istio-system --version=${ISTIO_VERSION} --wait \
        --set service.type=LoadBalancer; then
        log_warning "Failed to install Istio Gateway. Please check the logs and try again."
        cleanup
        exit 1
    fi
    log_success "Istio Gateway installed successfully"
fi

log_newline

cleanup
