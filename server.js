// server.js

// -----------------------------------------------------------------------------
// 1. IMPORTS E CONFIGURAÇÃO INICIAL
// -----------------------------------------------------------------------------
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; // Ex: mongodb://localhost:27017/investment_site ou sua string do Atlas/Render
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-strong-jwt-secret-key'; //
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://gold-mt.netlify.app'; // Ou a URL do seu frontend no Render
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || 'AdminPassword123!';
// -----------------------------------------------------------------------------
// 2. MIDDLEWARE
// -----------------------------------------------------------------------------
app.use(cors({
    origin: '*' // Permite requisições de qualquer origem. Para produção, restrinja ao seu frontend.
    // origin: [FRONTEND_URL, 'http://localhost:xxxx'] // Se tiver um admin em outra porta/url
}));
app.use(express.json()); // Para parsear JSON no corpo das requisições
app.use(express.urlencoded({ extended: true })); // Para parsear dados de formulário URL-encoded
// server.js
// ... (continuação da Parte 2: MIDDLEWARE)

// -----------------------------------------------------------------------------
// 3. CONEXÃO COM O MONGODB E CRIAÇÃO DE ADMIN INICIAL (Definições de função)
// (No seu arquivo original, esta era a seção 3, focada na função createInitialAdmin)
// -----------------------------------------------------------------------------

async function createInitialAdmin() {
    const adminEmail = ADMIN_EMAIL;
    const adminPassword = ADMIN_INITIAL_PASSWORD;

    if (!adminEmail || !adminPassword) {
        console.warn("Credenciais de admin inicial não definidas no .env. Nenhum admin inicial será criado.");
        return;
    }

    try {
        // Usar mongoose.model aqui pois o modelo User pode não estar globalmente definido
        // no momento exato em que esta função é chamada (dependendo da ordem de execução)
        // Esta função será chamada APÓS a definição dos modelos.
        const User = mongoose.model('User'); 
        const existingAdmin = await User.findOne({ email: adminEmail.toLowerCase() });

        if (existingAdmin) {
            console.log(`Usuário admin (${adminEmail}) já existe.`);
            if (!existingAdmin.isAdmin) {
                existingAdmin.isAdmin = true;
                await existingAdmin.save();
                console.log(`Usuário ${adminEmail} atualizado para admin.`);
            }
            return;
        }

        const name = "Administrador Principal";
        const securityQuestion = "Qual é o código de segurança do sistema?";
        const securityAnswer = "admin_recovery_code_123"; // Será hasheada no pre-save do UserSchema

        const newAdmin = new User({
            name,
            email: adminEmail.toLowerCase(),
            password: adminPassword, // O hashing ocorre no hook pre-save do UserSchema
            securityQuestion,
            securityAnswer, // O hashing ocorre no hook pre-save do UserSchema
            isAdmin: true,
            isBlocked: false,
            balance: { MT: 0 },
            bonusBalance: 0, // Admin não recebe bônus de cadastro inicial
            firstDepositMade: true // Admin não tem restrições de primeiro depósito
        });

        await newAdmin.save(); 
        console.log(`Usuário admin inicial (${adminEmail}) criado com sucesso.`);
        console.log("IMPORTANTE: O administrador deve alterar a senha padrão e a pergunta/resposta de segurança no primeiro login!");

    } catch (error) {
        if (error.message.includes("Schema hasn't been registered for model \"User\"")) {
             console.warn("createInitialAdmin: Modelo User ainda não registrado. Será tentado após a definição dos modelos.");
        } else {
            console.error("Erro ao tentar criar usuário admin inicial:", error);
        }
    }
}

// NOVA FUNÇÃO PARA INICIALIZAR CONFIGURAÇÕES PADRÃO
async function initializeDefaultSettings() {
    try {
        // Garante que o modelo AdminSetting está carregado antes de usá-lo.
        // Esta função será chamada APÓS a definição dos modelos.
        const AdminSetting = mongoose.model('AdminSetting'); 

        const defaultSettings = [
            { 
                key: 'registrationBonusAmount', 
                value: 200, // Valor padrão do bônus
                description: 'Valor do bônus de cadastro concedido a novos usuários (em MT).' 
            },
            { 
                key: 'isRegistrationBonusActive', 
                value: true, // Bônus ativo por padrão
                description: 'Controla se o bônus de cadastro está ativo (true) ou inativo (false).' 
            },
            {
                key: 'siteName',
                value: 'GoldMT Invest', // Valor padrão
                description: 'Nome do site exibido em títulos e outras áreas públicas.'
            },
            {
                key: 'minWithdrawalAmount',
                value: 50, // Valor padrão
                description: 'Valor mínimo para solicitação de saque em MT.'
            },
            {
                key: 'maxWithdrawalAmount',
                value: 50000, // Valor padrão
                description: 'Valor máximo para solicitação de saque em MT.'
            },
            {
                key: 'withdrawalFeeInfo', 
                value: 'Taxa de manuseio varia de 2% a 15% dependendo do valor e método.', // Valor padrão
                description: 'Informação sobre taxas de saque exibida ao usuário na página de saque.'
            },
            { // Adicionando outras configurações que seu frontend pode esperar
                key: 'withdrawalFeePercentageBase', value: 0.02, description: 'Taxa base de saque (ex: 0.02 para 2%)'
            },
            { 
                key: 'withdrawalFeeHighValueThreshold1', value: 10000, description: 'Primeiro limiar para taxa de saque mais alta'
            },
            {
                key: 'withdrawalFeeHighValuePercentage1', value: 0.05, description: 'Taxa para o primeiro limiar de valor alto (ex: 0.05 para 5%)'
            },
            {
                key: 'withdrawalFeeHighValueThreshold2', value: 25000, description: 'Segundo limiar para taxa de saque mais alta'
            },
            {
                key: 'withdrawalFeeHighValuePercentage2', value: 0.10, description: 'Taxa para o segundo limiar de valor alto (ex: 0.10 para 10%)'
            },
            {
                key: 'withdrawalFeeCryptoBonus', value: 0.02, description: 'Taxa adicional para saques em cripto (ex: 0.02 para +2%)'
            },
            {
                key: 'withdrawalFeeMaxPercentage', value: 0.15, description: 'Taxa máxima de saque aplicável (ex: 0.15 para 15%)'
            },
            {
                key: 'contactTextLogin',
                value: 'Em caso de problemas com o login, contate o suporte: +258 XX XXX XXXX',
                description: 'Texto de contato exibido na página de login.'
            },
            {
                key: 'contactTextRegister',
                value: 'Dúvidas no cadastro? Fale conosco: +258 YY YYY YYYY',
                description: 'Texto de contato exibido na página de registro.'
            },
            {
                key: 'contactTextPanel',
                value: 'Suporte rápido via WhatsApp: +258 ZZ ZZZ ZZZZ',
                description: 'Texto de contato exibido no painel do usuário.'
            },
            { // Configurações para moedas de claim, como discutido para /api/user/claims
                key: 'allowedClaimCurrencies',
                value: ["MT", "BTC", "ETH", "USDT"], // Array de strings
                description: 'Lista de moedas permitidas para o usuário selecionar ao fazer claim (Ex: ["MT", "BTC"]).'
            }
        ];

        for (const setting of defaultSettings) {
            const existingSetting = await AdminSetting.findOne({ key: setting.key });
            if (!existingSetting) {
                await AdminSetting.create(setting);
                console.log(`Configuração padrão '${setting.key}' criada com valor '${JSON.stringify(setting.value)}'.`);
            }
        }
        
        siteSettingsCache = null; 
        await getSiteSettings(); 
        console.log("Configurações padrão do site verificadas/inicializadas e cacheadas.");

    } catch (error) {
        if (error.message.includes("Schema hasn't been registered for model \"AdminSetting\"")) {
             console.warn("initializeDefaultSettings: Modelo AdminSetting ainda não registrado. Será tentado após a definição dos modelos.");
        } else {
            console.error("Erro ao inicializar configurações padrão do site:", error);
        }
    }
          }
// server.js
// ... (continuação da Parte 3 que definiu createInitialAdmin e initializeDefaultSettings)

// -----------------------------------------------------------------------------
// 4. MODELOS (SCHEMAS) DO MONGODB
// -----------------------------------------------------------------------------

// 4.1. Schema do Claim (Subdocumento do Usuário)
const claimSchema = new mongoose.Schema({
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
    planName: String,
    claimNumber: Number, // 1 a 5
    amount: Number, // Valor do claim em MT
    currency: String, // Moeda em que o valor foi creditado/representado (ex: MT, BTC, ETH)
    claimedAt: { type: Date, default: Date.now }
}); //

// 4.2. Schema do Investimento Ativo (Subdocumento do Usuário)
const activeInvestmentSchema = new mongoose.Schema({
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true }, //
    planName: { type: String, required: true }, //
    investedAmount: { type: Number, required: true }, //
    dailyProfitRate: { type: Number, required: true }, // Percentual //
    dailyProfitAmount: { type: Number, required: true }, // Em MT //
    claimValue: { type: Number, required: true }, // Valor de cada um dos 5 claims, em MT //
    claimsMadeToday: { type: Number, default: 0 }, //
    lastClaimDate: { type: Date }, //
    activatedAt: { type: Date, default: Date.now }, //
});

// 4.3. Schema do Usuário (User)
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true }, //
    email: { type: String, required: true, unique: true, trim: true, lowercase: true }, //
    password: { type: String, required: true }, //
    securityQuestion: { type: String, required: true }, //
    securityAnswer: { type: String, required: true }, // Será hasheada //
    referralCode: { type: String, unique: true }, //
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, //
    balance: { // Saldo principal em MT
        MT: { type: Number, default: 0 } //
    },
    bonusBalance: { type: Number, default: 0 }, // Saldo de bônus (cadastro, referência) //
    referralEarnings: { type: Number, default: 0 }, // Ganhos de referência já contabilizados //
    activeInvestments: [activeInvestmentSchema], //
    claimHistory: [claimSchema], //
    isBlocked: { type: Boolean, default: false }, //
    isAdmin: { type: Boolean, default: false }, //
    firstDepositMade: { type: Boolean, default: false }, //
    createdAt: { type: Date, default: Date.now }, //
    lastLoginAt: { type: Date } //
});

userSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    if (this.isModified('securityAnswer')) {
        this.securityAnswer = await bcrypt.hash(this.securityAnswer, 10);
    }
    if (!this.referralCode) {
        this.referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    }
    next();
}); //

const User = mongoose.model('User', userSchema);

// 4.4. Schema dos Planos de Investimento (Plan)
const planSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }, // Ex: "Plano de 500 MT" //
    investmentAmount: { type: Number, required: true, unique: true }, // Valor do plano, ex: 500 //
    dailyProfitRate: { type: Number, required: true }, // Em percentual, ex: 6.21 //
    dailyProfitAmount: { type: Number, required: true }, // Lucro por dia em MT, ex: 31.05 //
    claimValue: { type: Number, required: true }, // Valor de cada claim em MT, ex: 6.21 //
    claimsPerDay: { type: Number, default: 5 }, //
    isActive: { type: Boolean, default: true }, //
    order: { type: Number, default: 0 }, // Para ordenar a exibição dos planos //
    description: { type: String, default: '' },
    imageUrl: { type: String, default: '' },
    tags: [{ type: String }]
});

const Plan = mongoose.model('Plan', planSchema); //

// 4.5. Schema dos Depósitos (Deposit)
const depositSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, //
    amount: { type: Number, required: true }, //
    method: { type: String, required: true }, // Mpesa, Emola, BTC, ETH, USDT //
    transactionIdOrConfirmationMessage: { type: String, required: true }, // Número da transação ou mensagem colada //
    paymentDetailsUsed: { type: String }, // O número/carteira para onde o depósito foi feito //
    status: { type: String, enum: ['Pendente', 'Confirmado', 'Rejeitado'], default: 'Pendente' }, //
    requestedAt: { type: Date, default: Date.now }, //
    processedAt: { type: Date }, //
    adminNotes: { type: String } // Adicionado para consistência com withdrawals
});

const Deposit = mongoose.model('Deposit', depositSchema);

// 4.6. Schema de Saques (Withdrawal)
const withdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, //
    amount: { type: Number, required: true }, // Valor em MT a ser sacado //
    withdrawalMethod: { type: String, required: true }, // Mpesa, Emola, BTC, ETH, USDT //
    recipientInfo: { type: String, required: true }, // Número Mpesa/Emola, Endereço da carteira cripto //
    feeApplied: { type: Number, default: 0 }, // Taxa de manuseio em MT //
    netAmount: { type: Number, required: true }, // Valor líquido após taxa //
    status: { type: String, enum: ['Pendente', 'Processado', 'Rejeitado'], default: 'Pendente' }, //
    requestedAt: { type: Date, default: Date.now }, //
    processedAt: { type: Date }, //
    adminNotes: { type: String } //
});

const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// 4.7. Schema de Notificações (Notification) - Para admin enviar aos usuários
const notificationSchema = new mongoose.Schema({
    title: { type: String, required: true }, //
    message: { type: String, required: true }, //
    type: { type: String, enum: ['info', 'success', 'warning', 'danger', 'modal', 'banner'], default: 'info' }, // // Mapeado para 'success', 'error', 'alerta'
    targetAudience: { type: String, enum: ['all', 'specificUser', 'group'], default: 'all' }, // Para quem é //
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Se for para usuário específico //
    link: { type: String }, // Adicionado para notificações que podem ter um link de ação
    isActive: { type: Boolean, default: true }, //
    createdAt: { type: Date, default: Date.now }, //
    expiresAt: { type: Date } //
});

const Notification = mongoose.model('Notification', notificationSchema);

// 4.8. Schema de Status da Notificação por Usuário (UserNotificationStatus)
const userNotificationStatusSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', required: true },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
    isDeleted: { type: Boolean, default: false }, // Soft delete pelo usuário
    deletedAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});
userNotificationStatusSchema.index({ userId: 1, notificationId: 1 }, { unique: true });
userNotificationStatusSchema.index({ userId: 1, isRead: 1, isDeleted: 1 }); // Índice composto para consultas comuns

const UserNotificationStatus = mongoose.model('UserNotificationStatus', userNotificationStatusSchema);

// 4.9. Schema de Configurações do Admin (AdminSetting)
const paymentMethodSchema = new mongoose.Schema({ // Este schema não é um modelo, mas usado em AdminSetting
    name: { type: String, required: true }, // Mpesa, Emola, BTC, ETH, USDT //
    details: { type: String, required: true }, // Número da conta, endereço da carteira //
    instructions: { type: String }, // Instruções adicionais //
    isActive: { type: Boolean, default: true }, //
    type: { type: String, enum: ['fiat', 'crypto'], required: true} //
});

const adminSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, // Ex: 'contactTextLogin', 'mpesaDetails', 'btcWallet' //
    value: mongoose.Schema.Types.Mixed, // Pode ser string, objeto, array //
    description: String //
});
const AdminSetting = mongoose.model('AdminSetting', adminSettingSchema);

// 4.10. Schema do Histórico de Referências (ReferralHistory)
const referralHistorySchema = new mongoose.Schema({
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Quem indicou //
    referredId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, // Quem foi indicado //
    status: { type: String, enum: ['Pendente', 'Confirmado'], default: 'Pendente' }, // Confirmado quando o indicado faz o primeiro depósito //
    bonusAmount: { type: Number, default: 65 }, // MT //
    earnedAt: { type: Date } //
});
const ReferralHistory = mongoose.model('ReferralHistory', referralHistorySchema);

// 4.11. Schema de Promoções Urgentes (UrgentPromotion)
const urgentPromotionSchema = new mongoose.Schema({
    title: { type: String, required: true },
    image: { type: String }, // URL da imagem
    description: { type: String },
    expiresAt: { type: Date, required: true },
    link: { type: String },
    badgeText: { type: String, default: "URGENTE" },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});
const UrgentPromotion = mongoose.model('UrgentPromotion', urgentPromotionSchema);

// 4.12. Schema do Banner da Homepage (HomepageBanner)
const homepageBannerSchema = new mongoose.Schema({
    title: { type: String },
    mediaType: { type: String, enum: ['image', 'video'], required: true },
    mediaUrl: { type: String, required: true },
    videoPlatform: { type: String, enum: ['youtube', 'vimeo', 'local', 'other'], default: 'other' },
    textOverlay: { type: String },
    ctaText: { type: String },
    ctaLink: { type: String },
    backgroundColor: { type: String },
    textColor: { type: String },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
homepageBannerSchema.pre('save', function(next) { this.updatedAt = Date.now(); next(); });
const HomepageBanner = mongoose.model('HomepageBanner', homepageBannerSchema);

// 4.13. Schema de Categoria do Blog (BlogCategory)
const blogCategorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String }
});
blogCategorySchema.pre('validate', function(next) {
    if (this.name && !this.slug) {
        this.slug = this.name.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
    }
    next();
});
const BlogCategory = mongoose.model('BlogCategory', blogCategorySchema);

// 4.14. Schema de Tag do Blog (BlogTag)
const blogTagSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true }
});
blogTagSchema.pre('validate', function(next) {
    if (this.name && !this.slug) {
        this.slug = this.name.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
    }
    next();
});
const BlogTag = mongoose.model('BlogTag', blogTagSchema);

// 4.15. Schema de Post do Blog (BlogPost)
const blogPostSchema = new mongoose.Schema({
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    content: { type: String, required: true },
    excerpt: { type: String },
    coverImage: { type: String },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'BlogCategory' },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BlogTag' }],
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['draft', 'published', 'scheduled', 'archived'], default: 'draft' },
    isFeatured: { type: Boolean, default: false },
    publishedAt: { type: Date },
    seoTitle: { type: String },
    seoDescription: { type: String },
    seoKeywords: [{ type: String }],
    views: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
blogPostSchema.pre('validate', function(next) {
    if (this.title && !this.slug) {
        this.slug = this.title.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
    }
    if (this.status === 'published' && !this.publishedAt) {
        this.publishedAt = Date.now();
    }
    next();
});
blogPostSchema.pre('save', function(next) { this.updatedAt = Date.now(); next(); });
// blogPostSchema.index({ title: 'text', content: 'text', seoKeywords: 'text' }); // Considerar para busca textual avançada
const BlogPost = mongoose.model('BlogPost', blogPostSchema);
