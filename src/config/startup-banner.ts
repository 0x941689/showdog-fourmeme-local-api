export const BRAND_LOGO = `
 _______           _______             ______   _______  _______ 
(  ____ \\|\\     /|(  ___  )|\\     /|  (  __  \\ (  ___  )(  ____ \\
| (    \\/| )   ( || (   ) || )   ( |  | (  \\  )| (   ) || (    \\/
| (_____ | (___) || |   | || | _ | |  | |   ) || |   | || |      
(_____  )|  ___  || |   | || |( )| |  | |   | || |   | || | ____ 
      ) || (   ) || |   | || || || |  | |   ) || |   | || | \\_  )
/\\____) || )   ( || (___) || () () |  | (__/  )| (___) || (___) |
\\\\_______)|/     \\|(_______)(_______)  (______/ (_______)(_______)
`;

export const STARTUP_MESSAGES = {
    serverStarting: '🚀 服务器启动中...',
    serverStarted: '✅ 服务器启动成功',
    port: '端口',
    url: '访问地址',
    whitelist: '白名单IP',
    nodeStatus: '节点连接状态',
    latency: '延迟',
    connected: '已连接',
    disconnected: '未连接',
    checking: '检测中...',
    ms: '毫秒',
    none: '无',
    systemInfo: '系统信息',
    environment: '运行环境',
    version: '版本',
    buildTime: '构建时间'
};

export interface StartupStatus {
    port: number;
    url: string;
    whitelistIPs: string[];
    nodeStatus: {
        connected: boolean;
        latency?: number;
        endpoint?: string;
    };
    environment: string;
    version: string;
    buildTime: string;
    wallets?: Array<{
        id: number;
        name?: string;
        address: string;
        balance: string;
    }>;
}

export function formatStartupBanner(logo: string, status: StartupStatus): string {
    const messages = STARTUP_MESSAGES;
    const whitelistStr = status.whitelistIPs.length > 0 
        ? status.whitelistIPs.join(', ')
        : messages.none;
    
    const nodeStatusStr = status.nodeStatus.connected 
        ? `${messages.connected} (${status.nodeStatus.latency}${messages.ms})`
        : messages.disconnected;
    
    let banner = `
${logo}

═══════════════════════════════════════════════════════════════════════════════════════

${messages.serverStarted}

${messages.systemInfo}:
  ${messages.port}: ${status.port}
  ${messages.url}: ${status.url}
  ${messages.version}: ${status.version}

${messages.whitelist}: ${whitelistStr}

${messages.nodeStatus}: ${nodeStatusStr}
${status.nodeStatus.endpoint ? `  节点地址: ${status.nodeStatus.endpoint}` : ''}
`;

    if (status.wallets && status.wallets.length > 0) {
        banner += `

 💰 钱包信息:
 ${'═'.repeat(59)}
`;
        for (const w of status.wallets) {
            const namePart = w.name ? ` | 名称: ${w.name}` : '';
            banner += `🔑 钱包ID: ${w.id}${namePart}\n`;
            banner += `📍 地址: ${w.address}\n`;
            banner += `💎 BNB余额: ${w.balance} BNB\n`;
            banner += `${'─'.repeat(59)}\n`;
        }
        banner += `
`;
    }

    banner += `
═══════════════════════════════════════════════════════════════════════════════════════
`;

    return banner;
}