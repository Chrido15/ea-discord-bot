/**
 * Golden Noodles Discord Bot
 * A recognition system where users can send Golden Noodles to appreciate others
 */

const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, REST, Routes } = require('discord.js');
const SalesforceService = require('./services/salesforce');

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

// Initialize Salesforce service
const salesforce = new SalesforceService();

// Constants
const MONTHLY_NOODLE_LIMIT = 10;
const NOODLE_EMOJI = '⭐️';

/**
 * Register slash commands with Discord
 */
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('goldennoodle')
            .setDescription('Send a Golden Noodle to recognize someone\'s hard work!')
            .addUserOption(option =>
                option.setName('recipient')
                    .setDescription('The person you want to recognize')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('Why are you recognizing this person?')
                    .setRequired(false)
                    .setMaxLength(500)),
        
        new SlashCommandBuilder()
            .setName('noodles-remaining')
            .setDescription('Check how many Golden Noodles you have left to give this month'),
        
        new SlashCommandBuilder()
            .setName('noodles-received')
            .setDescription('Check how many Golden Noodles you\'ve received this month'),
        
        new SlashCommandBuilder()
            .setName('noodle-leaderboard')
            .setDescription('View the Golden Noodle leaderboard for this month')
    ].map(command => command.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Registering slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID),
            { body: commands }
        );
        console.log('Slash commands registered successfully!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

/**
 * Handle the /goldennoodle command
 */
async function handleGoldenNoodle(interaction) {
    await interaction.deferReply();

    const sender = interaction.user;
    const recipient = interaction.options.getUser('recipient');
    const message = interaction.options.getString('message') || 'For being awesome!';

    // Validate: Can't send to yourself
    if (sender.id === recipient.id) {
        return interaction.editReply({
            content: `${NOODLE_EMOJI} You can't send a Golden Noodle to yourself! Recognize someone else's hard work.`,
            ephemeral: true
        });
    }

    // Validate: Can't send to bots
    if (recipient.bot) {
        return interaction.editReply({
            content: `${NOODLE_EMOJI} Bots don't eat noodles! Please recognize a human team member.`,
            ephemeral: true
        });
    }

    try {
        // Check remaining noodles from Salesforce
        const remainingNoodles = await salesforce.getRemainingNoodles(
            sender.id,
            interaction.guildId
        );

        if (remainingNoodles <= 0) {
            return interaction.editReply({
                content: `${NOODLE_EMOJI} You've used all your Golden Noodles for this month! Your allocation will reset at the beginning of next month.`,
                ephemeral: true
            });
        }

        // Create transaction in Salesforce
        const transaction = await salesforce.createTransaction({
            senderId: sender.id,
            senderUsername: sender.username,
            senderDisplayName: sender.displayName || sender.username,
            recipientId: recipient.id,
            recipientUsername: recipient.username,
            recipientDisplayName: recipient.displayName || recipient.username,
            guildId: interaction.guildId,
            guildName: interaction.guild.name,
            channelId: interaction.channelId,
            message: message
        });

        // Create embed for channel announcement
        const embed = new EmbedBuilder()
            .setColor(0xFFD700) // Gold color
            .setTitle(`${NOODLE_EMOJI} Golden Noodle Received!`)
            .setDescription(`**${sender.displayName || sender.username}** sent a Golden Noodle to **${recipient.displayName || recipient.username}**!`)
            .addFields(
                { name: 'Recognition Message', value: message }
            )
            .setFooter({ text: `${remainingNoodles - 1} noodles remaining for ${sender.username} this month` })
            .setTimestamp();

        // Reply in channel
        await interaction.editReply({ embeds: [embed] });

        // Send DM to recipient
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor(0xFFD700)
                .setTitle(`${NOODLE_EMOJI} You received a Golden Noodle!`)
                .setDescription(`**${sender.displayName || sender.username}** recognized your hard work in **${interaction.guild.name}**!`)
                .addFields(
                    { name: 'Their Message', value: message }
                )
                .setTimestamp();

            await recipient.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            // User might have DMs disabled - that's okay
            console.log(`Could not DM ${recipient.username}: ${dmError.message}`);
        }

    } catch (error) {
        console.error('Error sending Golden Noodle:', error);
        await interaction.editReply({
            content: `${NOODLE_EMOJI} Oops! Something went wrong sending your Golden Noodle. Please try again later.`,
            ephemeral: true
        });
    }
}

/**
 * Handle the /noodles-remaining command
 */
async function handleNoodlesRemaining(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const remaining = await salesforce.getRemainingNoodles(
            interaction.user.id,
            interaction.guildId
        );

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle(`${NOODLE_EMOJI} Your Golden Noodle Balance`)
            .setDescription(`You have **${remaining}** Golden Noodles left to give this month.`)
            .addFields(
                { name: 'Monthly Allocation', value: `${MONTHLY_NOODLE_LIMIT} noodles`, inline: true },
                { name: 'Given This Month', value: `${MONTHLY_NOODLE_LIMIT - remaining} noodles`, inline: true }
            )
            .setFooter({ text: 'Your balance resets at the beginning of each month' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error checking remaining noodles:', error);
        await interaction.editReply({
            content: `${NOODLE_EMOJI} Couldn't check your noodle balance. Please try again later.`
        });
    }
}

/**
 * Handle the /noodles-received command
 */
async function handleNoodlesReceived(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const received = await salesforce.getReceivedNoodles(
            interaction.user.id,
            interaction.guildId
        );

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle(`${NOODLE_EMOJI} Golden Noodles You've Received`)
            .setDescription(`You've received **${received.count}** Golden Noodles this month!`)
            .setTimestamp();

        // Add recent recognitions if any
        if (received.recent && received.recent.length > 0) {
            const recentList = received.recent
                .slice(0, 5)
                .map(r => `• From **${r.senderName}**: "${r.message}"`)
                .join('\n');
            embed.addFields({ name: 'Recent Recognitions', value: recentList });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error checking received noodles:', error);
        await interaction.editReply({
            content: `${NOODLE_EMOJI} Couldn't check your received noodles. Please try again later.`
        });
    }
}

/**
 * Handle the /noodle-leaderboard command
 */
async function handleLeaderboard(interaction) {
    await interaction.deferReply();

    try {
        const leaderboard = await salesforce.getLeaderboard(interaction.guildId);

        const embed = new EmbedBuilder()
            .setColor(0xFFD700)
            .setTitle(`${NOODLE_EMOJI} Golden Noodle Leaderboard`)
            .setDescription('Top recognized team members this month')
            .setTimestamp();

        if (leaderboard.length === 0) {
            embed.setDescription('No Golden Noodles have been sent yet this month. Be the first to recognize someone!');
        } else {
            const medals = ['🥇', '🥈', '🥉'];
            const leaderboardText = leaderboard
                .slice(0, 10)
                .map((entry, index) => {
                    const medal = medals[index] || `${index + 1}.`;
                    return `${medal} **${entry.recipientName}** - ${entry.count} noodle${entry.count !== 1 ? 's' : ''}`;
                })
                .join('\n');

            embed.addFields({ name: 'Rankings', value: leaderboardText });
        }

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        await interaction.editReply({
            content: `${NOODLE_EMOJI} Couldn't load the leaderboard. Please try again later.`
        });
    }
}

// Event: Bot is ready
client.once('ready', async () => {
    console.log(`${NOODLE_EMOJI} Golden Noodles Bot is online as ${client.user.tag}!`);
    await registerCommands();
});

// Event: Handle interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    console.log(
        `Interaction received: ${interaction.commandName} in guild ${interaction.guildId} from ${interaction.user?.username}`
    );

    switch (interaction.commandName) {
        case 'goldennoodle':
            await handleGoldenNoodle(interaction);
            break;
        case 'noodles-remaining':
            await handleNoodlesRemaining(interaction);
            break;
        case 'noodles-received':
            await handleNoodlesReceived(interaction);
            break;
        case 'noodle-leaderboard':
            await handleLeaderboard(interaction);
            break;
    }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN);

module.exports = client;
