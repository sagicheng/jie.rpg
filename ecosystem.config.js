module.exports = {
  apps: [
    {
      name: 'jie-server',
      script: 'dist-server/server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        PORT: 2567,
        NODE_ENV: 'production',
      },
    },
  ],
};
