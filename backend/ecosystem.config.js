module.exports = {
  apps: [
    {
      name: "channelplay-helpdesk-api",
      script: "./start.js", // Use start.js to handle path alias resolution
      instances: "max", // Use max instances for load balancing (based on available CPUs)
      exec_mode: "cluster", // Run in cluster mode for better performance
      watch: false, // Don't watch for file changes in production
      max_memory_restart: "1G", // Restart if memory usage exceeds 1GB
      env_production: {
        NODE_ENV: "production",
        PORT: 8080,
        // Add other environment variables as needed (these will override .env.production)
      },
      // Error logs
      error_file: "./logs/error.log",
      // Console logs
      out_file: "./logs/out.log",
      // Merge error and console logs
      merge_logs: true,
      // Format logs as JSON
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      // Disable logs if you're using CloudWatch or another logging service
      // log_type: "json",
      // Restart app if it crashes
      autorestart: true,
      // Delay between automatic restarts
      restart_delay: 5000,
    }
  ],
  
  // Deployment configuration
  deploy: {
    production: {
      user: "ec2-user", // Change to your EC2 user
      host: ["your-production-host.com"], // Change to your EC2 host
      ref: "origin/main",
      repo: "git@github.com:AjayChannelplay/Channelplay-Helpdesk.git",
      path: "/var/www/channelplay-helpdesk",
      "post-deploy": "cd backend && npm install && npm run build && pm2 reload ecosystem.config.js --env production",
      "pre-deploy-local": "echo 'Deploying to production server...'",
      env: {
        NODE_ENV: "production",
      },
    },
    staging: {
      user: "ec2-user", // Change to your EC2 user
      host: ["your-staging-host.com"], // Change to your EC2 host
      ref: "origin/develop", // Use develop branch for staging
      repo: "git@github.com:AjayChannelplay/Channelplay-Helpdesk.git",
      path: "/var/www/channelplay-helpdesk-staging",
      "post-deploy": "cd backend && npm install && npm run build && pm2 reload ecosystem.config.js --env staging",
      "pre-deploy-local": "echo 'Deploying to staging server...'",
      env: {
        NODE_ENV: "staging",
      },
    }
  }
};
