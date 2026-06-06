/**
 * PM2 ecosystem — do NOT commit real DATABASE_URL or SESSION_SECRET.
 * On the server, set secrets in the environment (/opt/taxi1313/.env or systemd Environment=).
 * If you start via `pm2 start ecosystem.config.js`, ensure secrets are exported
 * in the shell beforehand (e.g. `set -a; . /opt/taxi1313/.env; set +a`).
 */
module.exports = {
  apps: [{
    name: 'taxi1313-api',
    script: '/opt/taxi1313/artifacts/api-server/dist/index.mjs',
    cwd: '/opt/taxi1313',
    instances: 1,
    exec_mode: 'fork',
    node_args: '--expose-gc --enable-source-maps --max-old-space-size=4096',
    env: {
      NODE_ENV: 'production',
      PORT: '4000',
      JAVA_HOME: '/usr/lib/jvm/java-17-openjdk-amd64',
      ANDROID_HOME: '/opt/android-sdk',
      GRADLE_HOME: '/opt/gradle-8.5',
    },
    max_memory_restart: '4G',
    watch: false,
    merge_logs: true,
    log_file: '/var/log/taxi1313/pm2-combined.log',
    error_file: '/var/log/taxi1313/pm2-error.log',
    out_file: '/var/log/taxi1313/pm2-out.log',
    restart_delay: 1000,
    max_restarts: 100,
    min_uptime: '10s',
    kill_timeout: 5000,
  }]
};
