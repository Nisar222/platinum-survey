#!/bin/bash
echo "🔧 Organizing project structure..."

# Create directories
mkdir -p server public/js public/css

# Move server files
[ -f "index.js" ] && mv index.js server/

# Move public files
[ -f "index.html" ] && mv index.html public/
[ -f "app.js" ] && mv app.js public/js/
[ -f "styles.css" ] && mv styles.css public/css/
[ -f "AYN_DIGITAL-03_500px.png" ] && mv AYN_DIGITAL-03_500px.png public/

echo "✅ Project structure organized!"
echo ""
echo "Structure:"
echo "├── server/"
echo "│   └── index.js"
echo "├── public/"
echo "│   ├── index.html"
echo "│   ├── js/app.js"
echo "│   └── AYN_DIGITAL-03_500px.png"
echo "├── package.json"
echo "└── .env"
echo ""
echo "Now run: npm install && npm start"