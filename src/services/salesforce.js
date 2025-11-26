/**
 * Salesforce Service
 * Handles all interactions with Salesforce for Golden Noodles transactions
 */

const jsforce = require('jsforce');

class SalesforceService {
    constructor() {
        this.conn = null;
        this.MONTHLY_LIMIT = 10;
    }

    /**
     * Connect to Salesforce using OAuth2
     */
    async connect() {
        if (this.conn && this.conn.accessToken) {
            return this.conn;
        }

        this.conn = new jsforce.Connection({
            loginUrl: process.env.SF_LOGIN_URL || 'https://login.salesforce.com',
            clientId: process.env.SF_CLIENT_ID,
            clientSecret: process.env.SF_CLIENT_SECRET
        });

        // Use username-password flow for server-to-server
        await this.conn.login(
            process.env.SF_USERNAME,
            process.env.SF_PASSWORD + process.env.SF_SECURITY_TOKEN
        );

        console.log('Connected to Salesforce:', this.conn.instanceUrl);
        return this.conn;
    }

    /**
     * Get the start of the current month in ISO format
     */
    getMonthStart() {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    }

    /**
     * Get remaining noodles for a user this month
     */
    async getRemainingNoodles(discordUserId, guildId) {
        await this.connect();

        const monthStart = this.getMonthStart();

        const result = await this.conn.query(`
            SELECT COUNT(Id) sentCount
            FROM Golden_Noodle_Transaction__c
            WHERE Sender_Discord_Id__c = '${discordUserId}'
            AND Guild_Id__c = '${guildId}'
            AND CreatedDate >= ${monthStart}
        `);

        const sentCount = result.records[0]?.sentCount || 0;
        return Math.max(0, this.MONTHLY_LIMIT - sentCount);
    }

    /**
     * Get received noodles count and recent transactions for a user
     */
    async getReceivedNoodles(discordUserId, guildId) {
        await this.connect();

        const monthStart = this.getMonthStart();

        // Get count
        const countResult = await this.conn.query(`
            SELECT COUNT(Id) receivedCount
            FROM Golden_Noodle_Transaction__c
            WHERE Recipient_Discord_Id__c = '${discordUserId}'
            AND Guild_Id__c = '${guildId}'
            AND CreatedDate >= ${monthStart}
        `);

        // Get recent transactions
        const recentResult = await this.conn.query(`
            SELECT Sender_Display_Name__c, Message__c, CreatedDate
            FROM Golden_Noodle_Transaction__c
            WHERE Recipient_Discord_Id__c = '${discordUserId}'
            AND Guild_Id__c = '${guildId}'
            AND CreatedDate >= ${monthStart}
            ORDER BY CreatedDate DESC
            LIMIT 5
        `);

        return {
            count: countResult.records[0]?.receivedCount || 0,
            recent: recentResult.records.map(r => ({
                senderName: r.Sender_Display_Name__c,
                message: r.Message__c,
                date: r.CreatedDate
            }))
        };
    }

    /**
     * Create a new Golden Noodle transaction
     */
    async createTransaction(data) {
        await this.connect();

        const transaction = {
            Sender_Discord_Id__c: data.senderId,
            Sender_Username__c: data.senderUsername,
            Sender_Display_Name__c: data.senderDisplayName,
            Recipient_Discord_Id__c: data.recipientId,
            Recipient_Username__c: data.recipientUsername,
            Recipient_Display_Name__c: data.recipientDisplayName,
            Guild_Id__c: data.guildId,
            Guild_Name__c: data.guildName,
            Channel_Id__c: data.channelId,
            Message__c: data.message
        };

        const result = await this.conn.sobject('Golden_Noodle_Transaction__c').create(transaction);

        if (!result.success) {
            throw new Error(`Failed to create transaction: ${JSON.stringify(result.errors)}`);
        }

        console.log('Created Golden Noodle transaction:', result.id);
        return result;
    }

    /**
     * Get leaderboard for a guild
     */
    async getLeaderboard(guildId) {
        await this.connect();

        const monthStart = this.getMonthStart();

        const result = await this.conn.query(`
            SELECT Recipient_Discord_Id__c, Recipient_Display_Name__c, COUNT(Id) noodleCount
            FROM Golden_Noodle_Transaction__c
            WHERE Guild_Id__c = '${guildId}'
            AND CreatedDate >= ${monthStart}
            GROUP BY Recipient_Discord_Id__c, Recipient_Display_Name__c
            ORDER BY COUNT(Id) DESC
            LIMIT 10
        `);

        return result.records.map(r => ({
            recipientId: r.Recipient_Discord_Id__c,
            recipientName: r.Recipient_Display_Name__c,
            count: r.noodleCount
        }));
    }

    /**
     * Get all transactions for a specific month (for reporting)
     */
    async getMonthlyTransactions(guildId, year, month) {
        await this.connect();

        const startDate = new Date(year, month - 1, 1).toISOString();
        const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();

        const result = await this.conn.query(`
            SELECT 
                Id,
                Sender_Discord_Id__c,
                Sender_Display_Name__c,
                Recipient_Discord_Id__c,
                Recipient_Display_Name__c,
                Message__c,
                CreatedDate
            FROM Golden_Noodle_Transaction__c
            WHERE Guild_Id__c = '${guildId}'
            AND CreatedDate >= ${startDate}
            AND CreatedDate <= ${endDate}
            ORDER BY CreatedDate DESC
        `);

        return result.records;
    }
}

module.exports = SalesforceService;
