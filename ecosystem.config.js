module.exports = {
  apps: [
    {
      name: 'whatsapp-ai-bot',
      script: 'start-ai-bot.js',
      cwd: '/home/whatsapp', // Set the correct working directory
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        BOT_PORT: 3000,
        INSTANCE_ID: 'main-bot',
        NODE_OPTIONS: '--max-old-space-size=768'
      },
      log_file: './logs/whatsapp-bot.log',
      out_file: './logs/whatsapp-bot-out.log',
      error_file: './logs/whatsapp-bot-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      min_uptime: '30s',
      max_restarts: 3,
      restart_delay: 10000,
      node_args: '--max-old-space-size=768',
      kill_timeout: 10000,
      listen_timeout: 10000,
      cron_restart: '0 */6 * * *'
    },
    {
      name: 'fixed-whatsapp-bot',
      script: 'start-fixed-bot.js',
      cwd: '/home/whatsapp', // Set the correct working directory
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '800M',
      env: {
        NODE_ENV: 'production',
        BOT_PORT: 4001,
        INSTANCE_ID: 'fixed-bot',
        NODE_OPTIONS: '--max-old-space-size=768'
      },
      log_file: './logs/fixed-bot.log',
      out_file: './logs/fixed-bot-out.log',
      error_file: './logs/fixed-bot-error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      min_uptime: '30s',
      max_restarts: 3,
      restart_delay: 10000,
      node_args: '--max-old-space-size=768',
      kill_timeout: 10000,
      listen_timeout: 10000,
      cron_restart: '0 */6 * * *'
    }
  ]
};