#!/bin/bash

# AYN Digital - Vapi Web Call App Deployment Script
# For Ubuntu-based AWS VPS

echo "🚀 Starting deployment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root. Please run as a regular user with sudo privileges."
   exit 1
fi

# Update system
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    print_status "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt install -y nodejs
else
    print_status "Node.js already installed: $(node -v)"
fi

# Install PM2 if not present
if ! command -v pm2 &> /dev/null; then
    print_status "Installing PM2..."
    sudo npm install -g pm2
else
    print_status "PM2 already installed"
fi

# Install nginx if not present
if ! command -v nginx &> /dev/null; then
    print_status "Installing Nginx..."
    sudo apt install -y nginx
else
    print_status "Nginx already installed"
fi

# Navigate to application directory
APP_DIR="/home/$(whoami)/vapi-web-call-app"
cd "$APP_DIR" || exit

# Install dependencies
print_status "Installing application dependencies..."
npm install --production

# Create uploads directory if it doesn't exist
mkdir -p uploads

# Stop existing PM2 process if running
if pm2 list | grep -q "vapi-web-app"; then
    print_status "Stopping existing PM2 process..."
    pm2 delete vapi-web-app
fi

# Start application with PM2
print_status "Starting application with PM2..."
pm2 start server/index.js --name vapi-web-app

# Save PM2 configuration
pm2 save

# Setup PM2 startup script
print_status "Configuring PM2 to start on boot..."
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $(whoami) --hp /home/$(whoami)

# Configure nginx
print_status "Configuring Nginx..."

# Prompt for domain name
read -p "Enter your domain name (or press Enter to skip): " DOMAIN_NAME

if [ ! -z "$DOMAIN_NAME" ]; then
    # Create nginx configuration
    sudo tee /etc/nginx/sites-available/vapi-app > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN_NAME;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

    # Enable site
    sudo ln -sf /etc/nginx/sites-available/vapi-app /etc/nginx/sites-enabled/
    
    # Remove default site if exists
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Test nginx configuration
    if sudo nginx -t; then
        print_status "Nginx configuration is valid"
        sudo systemctl restart nginx
        print_status "Nginx restarted"
    else
        print_error "Nginx configuration test failed"
    fi

    # Prompt for SSL
    read -p "Do you want to install SSL certificate with Let's Encrypt? (y/n): " INSTALL_SSL
    if [[ $INSTALL_SSL == "y" || $INSTALL_SSL == "Y" ]]; then
        if ! command -v certbot &> /dev/null; then
            print_status "Installing Certbot..."
            sudo apt install -y certbot python3-certbot-nginx
        fi
        
        print_status "Installing SSL certificate..."
        sudo certbot --nginx -d $DOMAIN_NAME --non-interactive --agree-tos --register-unsafely-without-email
        
        print_status "SSL certificate installed successfully"
    fi
else
    print_warning "Skipping Nginx configuration"
fi

# Configure firewall
if command -v ufw &> /dev/null; then
    print_status "Configuring firewall..."
    sudo ufw allow 'Nginx Full'
    sudo ufw allow OpenSSH
    
    # Check if ufw is inactive and enable it
    if ! sudo ufw status | grep -q "Status: active"; then
        print_warning "Enabling UFW firewall..."
        echo "y" | sudo ufw enable
    fi
else
    print_warning "UFW firewall not found, skipping firewall configuration"
fi

# Display status
echo ""
echo "================================================"
print_status "Deployment completed successfully!"
echo "================================================"
echo ""

# Show application status
print_status "Application Status:"
pm2 list

echo ""
if [ ! -z "$DOMAIN_NAME" ]; then
    print_status "Your application is accessible at:"
    echo "   → http://$DOMAIN_NAME"
    if [[ $INSTALL_SSL == "y" || $INSTALL_SSL == "Y" ]]; then
        echo "   → https://$DOMAIN_NAME"
    fi
else
    print_status "Your application is running on port 3000"
    echo "   → http://localhost:3000"
    print_warning "Configure Nginx manually to make it accessible via domain"
fi

echo ""
print_status "Useful Commands:"
echo "   → View logs: pm2 logs vapi-web-app"
echo "   → Restart app: pm2 restart vapi-web-app"
echo "   → Stop app: pm2 stop vapi-web-app"
echo "   → Monitor app: pm2 monit"
echo ""
