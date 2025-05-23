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
const crypto = require('crypto');
const multer = require('multer'); // NOVO: Para upload de arquivos
const path = require('path');     // NOVO: Para lidar com caminhos de arquivo
const fs = require('fs');         // NOVO: Para interagir com o sistema de arquivos (criar pastas, etc.)

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'your-very-strong-jwt-secret-key';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://gold-mt.netlify.app';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_INITIAL_PASSWORD = process.env.ADMIN_INITIAL_PASSWORD || 'AdminPassword123!';

// Configuração do Multer para Upload de Arquivos
const UPLOADS_DIR = path.join(__dirname, 'uploads'); // Pasta onde os arquivos serão salvos
if (!fs.existsSync(UPLOADS_DIR)){
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Poderíamos ter subpastas baseadas no tipo de upload, ex: req.uploadType
        let uploadPath = UPLOADS_DIR;
        if (req.uploadPathSuffix) { // Ex: 'banners', 'blog-covers', 'plan-images'
            uploadPath = path.join(UPLOADS_DIR, req.uploadPathSuffix);
            if (!fs.existsSync(uploadPath)){
                fs.mkdirSync(uploadPath, { recursive: true });
            }
        }
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
    }
});

const fileFilter = (req, file, cb) => {
    // Aceitar imagens e vídeos, outros tipos podem ser adicionados
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de arquivo não suportado! Apenas imagens e vídeos são permitidos.'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 50 // Limite de 50MB por arquivo (ajustável)
    },
    fileFilter: fileFilter
});

// Servir arquivos estáticos da pasta 'uploads'
app.use('/uploads', express.static(UPLOADS_DIR));


// -----------------------------------------------------------------------------
// 2. MIDDLEWARE
// -----------------------------------------------------------------------------
app.use(cors({
    origin: '*' // Para produção, restrinja ao seu frontend.
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// -----------------------------------------------------------------------------
// 3. FUNÇÕES DE CRIAÇÃO DE ADMIN INICIAL E CONFIGURAÇÕES PADRÃO
// -----------------------------------------------------------------------------

async function createInitialAdmin() {
    const adminEmail = ADMIN_EMAIL;
    const adminPassword = ADMIN_INITIAL_PASSWORD;

    if (!adminEmail || !adminPassword) {
        console.warn("Credenciais de admin inicial não definidas no .env. Nenhum admin inicial será criado.");
        return;
    }
    try {
        const User = mongoose.model('User'); // Assegura que o modelo User está disponível
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
        const securityAnswer = "admin_recovery_code_123";

        const newAdmin = new User({
            name,
            email: adminEmail.toLowerCase(),
            password: adminPassword,
            securityQuestion,
            securityAnswer,
            isAdmin: true,
            isBlocked: false,
            balance: { MT: 0 },
            bonusBalance: 0,
            firstDepositMade: true
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

async function initializeDefaultSettings() {
    try {
        const AdminSetting = mongoose.model('AdminSetting'); // Assegura que o modelo está disponível

        const defaultSettings = [
            { key: 'registrationBonusAmount', value: 200, description: 'Valor do bônus de cadastro concedido a novos usuários (em MT).' },
            { key: 'isRegistrationBonusActive', value: true, description: 'Controla se o bônus de cadastro está ativo (true) ou inativo (false).' },
            // NOVAS CONFIGURAÇÕES DE COMISSÃO DE REFERÊNCIA
            { key: 'referralCommissionOnRegistrationPercentage', value: 0.30, description: 'Percentagem (0 a 1) da comissão de referência sobre o valor do primeiro plano ativado pelo indicado (ex: 0.30 para 30%). Paga ao referenciador.' },
            { key: 'isReferralCommissionOnRegistrationActive', value: true, description: 'Controla se a comissão de referência no registro do indicado está ativa.' },
            { key: 'referralCommissionOnClaimsPercentage', value: 0.20, description: 'Percentagem (0 a 1) da comissão de referência sobre o valor dos claims diários dos indicados (ex: 0.20 para 20%). Paga ao referenciador.' },
            { key: 'isReferralCommissionOnClaimsActive', value: true, description: 'Controla se a comissão de referência sobre claims dos indicados está ativa.' },
            // NOVAS CONFIGURAÇÕES PADRÃO DE DURAÇÃO DE PLANO
            { key: 'defaultPlanDurationValue', value: null, description: 'Valor padrão para a duração do plano (ex: 30, 7). Usar null ou 0 para vitalício.' }, // null ou 0 para vitalício
            { key: 'defaultPlanDurationType', value: 'lifelong', description: "Tipo padrão para a duração do plano ('days', 'weeks', 'lifelong')." },

            { key: 'siteName', value: 'GoldMT Invest', description: 'Nome do site exibido em títulos e outras áreas públicas.' },
            { key: 'minWithdrawalAmount', value: 50, description: 'Valor mínimo para solicitação de saque em MT.' },
            { key: 'maxWithdrawalAmount', value: 50000, description: 'Valor máximo para solicitação de saque em MT.' },
            { key: 'withdrawalFeeInfo', value: 'Taxa de manuseio varia de 2% a 15% dependendo do valor e método.', description: 'Informação sobre taxas de saque exibida ao usuário na página de saque.' },
            { key: 'withdrawalFeePercentageBase', value: 0.02, description: 'Taxa base de saque (ex: 0.02 para 2%)' },
            { key: 'withdrawalFeeHighValueThreshold1', value: 10000, description: 'Primeiro limiar para taxa de saque mais alta' },
            { key: 'withdrawalFeeHighValuePercentage1', value: 0.05, description: 'Taxa para o primeiro limiar de valor alto (ex: 0.05 para 5%)' },
            { key: 'withdrawalFeeHighValueThreshold2', value: 25000, description: 'Segundo limiar para taxa de saque mais alta' },
            { key: 'withdrawalFeeHighValuePercentage2', value: 0.10, description: 'Taxa para o segundo limiar de valor alto (ex: 0.10 para 10%)' },
            { key: 'withdrawalFeeCryptoBonus', value: 0.02, description: 'Taxa adicional para saques em cripto (ex: 0.02 para +2%)' },
            { key: 'withdrawalFeeMaxPercentage', value: 0.15, description: 'Taxa máxima de saque aplicável (ex: 0.15 para 15%)' },
            { key: 'contactTextLogin', value: 'Em caso de problemas com o login, contate o suporte: +258 XX XXX XXXX', description: 'Texto de contato exibido na página de login.' },
            { key: 'contactTextRegister', value: 'Dúvidas no cadastro? Fale conosco: +258 YY YYY YY', description: 'Texto de contato exibido na página de registro.' },
            { key: 'contactTextPanel', value: 'Suporte rápido via WhatsApp: +258 ZZ ZZZ ZZZZ', description: 'Texto de contato exibido no painel do usuário.' },
            { key: 'allowedClaimCurrencies', value: ["MT", "BTC", "ETH", "USDT"], description: 'Lista de moedas permitidas para o usuário selecionar ao fazer claim (Ex: ["MT", "BTC"]).' }
        ];

        for (const setting of defaultSettings) {
            const existingSetting = await AdminSetting.findOne({ key: setting.key });
            if (!existingSetting) {
                await AdminSetting.create(setting);
                console.log(`Configuração padrão '${setting.key}' criada com valor '${JSON.stringify(setting.value)}'.`);
            } else {
                if (existingSetting.description !== setting.description) {
                    existingSetting.description = setting.description; // Atualiza a descrição se mudou
                    await existingSetting.save();
                }
            }
        }
        siteSettingsCache = null; // Limpa o cache para recarregar
        await getSiteSettings(); // Recarrega as configurações no cache
        console.log("Configurações padrão do site verificadas/inicializadas e cacheadas.");
    } catch (error) {
        if (error.message.includes("Schema hasn't been registered for model \"AdminSetting\"")) {
             console.warn("initializeDefaultSettings: Modelo AdminSetting ainda não registrado. Será tentado após a definição dos modelos.");
        } else {
            console.error("Erro ao inicializar configurações padrão do site:", error);
        }
    }
}

// -----------------------------------------------------------------------------
// 4. MODELOS (SCHEMAS) DO MONGODB
// -----------------------------------------------------------------------------

// 4.1. Schema do Claim (Subdocumento do Usuário) - Inalterado por enquanto
const claimSchema = new mongoose.Schema({
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
    planName: String,
    claimNumber: Number, // 1 a 5
    amount: Number, // Valor do claim em MT
    currency: String, // Moeda em que o valor foi creditado/representado (ex: MT, BTC, ETH)
    claimedAt: { type: Date, default: Date.now }
});

// 4.2. Schema do Investimento Ativo (Subdocumento do Usuário) - ATUALIZADO
const activeInvestmentSchema = new mongoose.Schema({
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    planName: { type: String, required: true },
    investedAmount: { type: Number, required: true },
    dailyProfitRate: { type: Number, required: true },
    dailyProfitAmount: { type: Number, required: true },
    claimValue: { type: Number, required: true },
    claimsMadeToday: { type: Number, default: 0 },
    lastClaimDate: { type: Date },
    activatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null } // NOVO: Data de expiração do plano para o usuário
});

// 4.3. Schema do Usuário (User) - ATUALIZADO
const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    securityQuestion: { type: String, required: true },
    securityAnswer: { type: String, required: true },
    referralCode: { type: String, unique: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    balance: {
        MT: { type: Number, default: 0 }
    },
    bonusBalance: { type: Number, default: 0 },
    // referralEarnings: { type: Number, default: 0 }, // REMOVIDO: Comissões serão tratadas de forma diferente
    totalCommissionEarned: { type: Number, default: 0 }, // NOVO: Para rastrear comissões totais ganhas (opcional, pode ser calculado)
    activeInvestments: [activeInvestmentSchema],
    claimHistory: [claimSchema],
    isBlocked: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    firstDepositMade: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastLoginAt: { type: Date },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date }
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
});

const User = mongoose.model('User', userSchema);

// NOVO SCHEMA: Categoria de Plano
const planCategorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String },
    order: { type: Number, default: 0 } // Para ordenação das categorias
});

planCategorySchema.pre('validate', function(next) {
    if (this.name && !this.slug) {
        this.slug = this.name.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
    }
    next();
});
const PlanCategory = mongoose.model('PlanCategory', planCategorySchema);


// 4.4. Schema dos Planos de Investimento (Plan) - ATUALIZADO
const planSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    investmentAmount: { type: Number, required: true, unique: true }, // Considerar se o valor ainda deve ser único se houver planos com mesma duração mas valores diferentes
    dailyProfitRate: { type: Number, required: true },
    dailyProfitAmount: { type: Number, required: true },
    claimValue: { type: Number, required: true },
    claimsPerDay: { type: Number, default: 5 },
    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    description: { type: String, default: '' },
    imageUrl: { type: String, default: '' }, // Será atualizado para usar uploads locais
    tags: [{ type: String }],
    // NOVOS CAMPOS PARA DURAÇÃO
    durationValue: { type: Number, default: null }, // Ex: 30, 7. null ou 0 para vitalício
    durationType: { type: String, enum: ['days', 'weeks', 'lifelong'], default: 'lifelong' },
    // NOVO CAMPO PARA CATEGORIA
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'PlanCategory', default: null },
    // NOVO CAMPO (opcional, para controle avançado de comissão por claims)
    maxActiveReferralsForClaimCommission: {type: Number, default: null } // Ex: referenciador só ganha comissão dos claims dos primeiros X indicados ativos.
});

const Plan = mongoose.model('Plan', planSchema);

// 4.5. Schema dos Depósitos (Deposit) - Inalterado
const depositSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true },
    transactionIdOrConfirmationMessage: { type: String, required: true },
    paymentDetailsUsed: { type: String },
    status: { type: String, enum: ['Pendente', 'Confirmado', 'Rejeitado'], default: 'Pendente' },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    adminNotes: { type: String }
});
const Deposit = mongoose.model('Deposit', depositSchema);

// 4.6. Schema de Saques (Withdrawal) - Inalterado
const withdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    withdrawalMethod: { type: String, required: true },
    recipientInfo: { type: String, required: true },
    feeApplied: { type: Number, default: 0 },
    netAmount: { type: Number, required: true },
    status: { type: String, enum: ['Pendente', 'Processado', 'Rejeitado'], default: 'Pendente' },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    adminNotes: { type: String }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// 4.7. Schema de Notificações (Notification) - Inalterado
const notificationSchema = new mongoose.Schema({
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ['info', 'success', 'warning', 'danger', 'modal', 'banner'], default: 'info' },
    targetAudience: { type: String, enum: ['all', 'specificUser', 'group'], default: 'all' },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    link: { type: String },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date }
});
const Notification = mongoose.model('Notification', notificationSchema);

// 4.8. Schema de Status da Notificação por Usuário (UserNotificationStatus) - Inalterado
const userNotificationStatusSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notification', required: true },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});
userNotificationStatusSchema.index({ userId: 1, notificationId: 1 }, { unique: true });
userNotificationStatusSchema.index({ userId: 1, isRead: 1, isDeleted: 1 });
const UserNotificationStatus = mongoose.model('UserNotificationStatus', userNotificationStatusSchema);

// 4.9. Schema de Configurações do Admin (AdminSetting) - Estrutura inalterada, mas com novas chaves em initializeDefaultSettings
const adminSettingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed,
    description: String
});
const AdminSetting = mongoose.model('AdminSetting', adminSettingSchema);

// 4.10. Schema do Histórico de Referências (ReferralHistory) - ATUALIZADO
const referralHistorySchema = new mongoose.Schema({
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Quem indicou
    referredId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true }, // Quem foi indicado
    status: { type: String, enum: ['Pendente', 'Comissão Paga', 'Expirado'], default: 'Pendente' }, // Status da referência
    commissionEarnedOnRegistration: { type: Number, default: 0 }, // Comissão ganha quando o indicado ativa o primeiro plano
    registrationCommissionPaidAt: { type: Date }, // Data que a comissão de registro foi paga
    firstPlanActivatedByReferred: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null }, // Primeiro plano ativado pelo indicado
    firstPlanActivationDate: { type: Date },
    dailyClaimCommissionLastPaidAt: {type: Date, default: null }, // Para rastrear pagamento de comissão de claims
    createdAt: { type: Date, default: Date.now }
});
referralHistorySchema.index({ referrerId: 1, status: 1 });
referralHistorySchema.index({ referredId: 1, status: 1 });
const ReferralHistory = mongoose.model('ReferralHistory', referralHistorySchema);

// 4.11. Schema de Promoções Urgentes (UrgentPromotion) - Inalterado por enquanto (countdown é frontend)
const urgentPromotionSchema = new mongoose.Schema({
    title: { type: String, required: true },
    image: { type: String }, // Será atualizado para usar uploads locais
    description: { type: String },
    expiresAt: { type: Date, required: true },
    link: { type: String },
    badgeText: { type: String, default: "URGENTE" },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});
const UrgentPromotion = mongoose.model('UrgentPromotion', urgentPromotionSchema);

// 4.12. Schema do Banner da Homepage (HomepageBanner) - ATUALIZADO
const homepageBannerSchema = new mongoose.Schema({
    title: { type: String },
    mediaType: { type: String, enum: ['image', 'video'], required: true },
    mediaUrl: { type: String, required: true }, // Se for local, será o path relativo, ex: /uploads/banners/nomearquivo.jpg
    videoPlatform: { type: String, enum: ['youtube', 'vimeo', 'local', 'other'], default: 'other' },
    textOverlay: { type: String },
    ctaText: { type: String },
    ctaLink: { type: String },
    // backgroundColor: { type: String }, // REMOVIDO
    textColor: { type: String },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    isLocalFile: { type: Boolean, default: false }, // NOVO: para diferenciar URL externa de arquivo local
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
homepageBannerSchema.pre('save', function(next) { this.updatedAt = Date.now(); next(); });
const HomepageBanner = mongoose.model('HomepageBanner', homepageBannerSchema);

// 4.13. Schema de Categoria do Blog (BlogCategory) - Inalterado
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

// 4.14. Schema de Tag do Blog (BlogTag) - Inalterado
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

// 4.15. Schema de Post do Blog (BlogPost) - imageUrl/coverImage será atualizado para upload local
const blogPostSchema = new mongoose.Schema({
    title: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    content: { type: String, required: true },
    excerpt: { type: String },
    coverImage: { type: String }, // Path relativo se for local
    isCoverImageLocal: { type: Boolean, default: false }, // NOVO
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
const BlogPost = mongoose.model('BlogPost', blogPostSchema);

// NOVO SCHEMA: DailyClaimCommissionLog (Para rastrear comissões de claims pagas)
const dailyClaimCommissionLogSchema = new mongoose.Schema({
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referredId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referralHistoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReferralHistory', required: true},
    totalClaimsAmountByReferred: { type: Number, required: true }, // Soma dos claims do indicado no dia
    commissionPercentageApplied: { type: Number, required: true },
    commissionEarned: { type: Number, required: true },
    date: { type: Date, required: true }, // Dia para o qual a comissão foi calculada
    paidAt: { type: Date, default: Date.now }
});
dailyClaimCommissionLogSchema.index({ referrerId: 1, date: -1 });
dailyClaimCommissionLogSchema.index({ referralHistoryId: 1, date: -1 });
const DailyClaimCommissionLog = mongoose.model('DailyClaimCommissionLog', dailyClaimCommissionLogSchema);


// -----------------------------------------------------------------------------
// CONEXÃO COM O MONGODB
// -----------------------------------------------------------------------------
mongoose.connect(MONGO_URI, {
    // useNewUrlParser: true, // Deprecated
    // useUnifiedTopology: true, // Deprecated
    // useCreateIndex: true, // Não mais necessário
    // useFindAndModify: false // Não mais necessário
})
.then(async () => {
    console.log('MongoDB conectado com sucesso!');
    // É importante que os modelos sejam definidos ANTES de chamar estas funções
    // se elas dependem da existência dos modelos para popular ou verificar dados.
    await initializeDefaultSettings(); // Deve ser chamado após a definição de AdminSetting
    await createInitialAdmin(); // Deve ser chamado após a definição de User
})
.catch(err => console.error('Erro ao conectar ao MongoDB:', err));
// server.js (Continuação - PARTE 2)

// ... (Schemas e conexão com MongoDB da Parte 1) ...

// -----------------------------------------------------------------------------
// 5. FUNÇÕES UTILITÁRIAS
// -----------------------------------------------------------------------------

const generateToken = (userId, isAdmin = false) => {
    return jwt.sign({ id: userId, isAdmin }, JWT_SECRET, { expiresIn: '24h' });
};

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Acesso não autorizado: Token não fornecido.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error("Erro na verificação do JWT:", err.message);
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Token expirado. Por favor, faça login novamente.' });
            }
            return res.status(403).json({ message: 'Token inválido.' });
        }
        req.user = decoded; // Contém id e isAdmin
        next();
    });
};

const authorizeAdmin = (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ message: 'Acesso negado: Recurso exclusivo para administradores.' });
    }
    next();
};

let siteSettingsCache = null;
async function getSiteSettings() {
    if (siteSettingsCache && Object.keys(siteSettingsCache).length > 0) {
        // Opcional: adicionar uma verificação de tempo para invalidar o cache periodicamente
        // console.log("Retornando configurações do cache.");
        return siteSettingsCache;
    }
    try {
        // console.log("Buscando configurações do DB.");
        const AdminSetting = mongoose.model('AdminSetting');
        const settings = await AdminSetting.find({});
        const formattedSettings = {};
        settings.forEach(setting => {
            formattedSettings[setting.key] = setting.value;
        });
        siteSettingsCache = formattedSettings;
        return formattedSettings;
    } catch (error) {
        console.error("Erro ao buscar configurações do site em getSiteSettings:", error);
        // Em caso de erro, retorna um objeto vazio ou as últimas configurações válidas em cache, se houver.
        // Por segurança, retornar um objeto vazio pode ser melhor para evitar usar configurações desatualizadas.
        return {};
    }
}

// Middleware para definir o caminho de upload (usado antes das rotas de upload)
// Exemplo: req.uploadPathSuffix = 'banners';
const setUploadPath = (pathSuffix) => {
    return (req, res, next) => {
        req.uploadPathSuffix = pathSuffix;
        next();
    };
};

// -----------------------------------------------------------------------------
// 6. CRON JOBS
// -----------------------------------------------------------------------------

// 6.1. Reset de Claims Diários (Existente)
cron.schedule('0 0 * * *', async () => {
    console.log('CRON: Iniciando reset de claims diários para o fuso de Maputo...');
    try {
        const usersWithActiveInvestments = await User.find({
            'activeInvestments.0': { $exists: true }
        });

        let usersResetCount = 0;
        for (const user of usersWithActiveInvestments) {
            let userModified = false;
            for (const investment of user.activeInvestments) {
                // Verifica também se o investimento ainda está ativo (não expirou)
                if (investment.expiresAt && new Date() > new Date(investment.expiresAt)) {
                    // Opcional: Adicionar lógica para marcar o investimento como expirado no usuário se necessário aqui,
                    // ou deixar para o cron de expiração de planos.
                    continue;
                }
                if (investment.claimsMadeToday > 0) {
                    investment.claimsMadeToday = 0;
                    userModified = true;
                }
            }
            if (userModified) {
                await user.save();
                usersResetCount++;
            }
        }
        if (usersResetCount > 0) {
            console.log(`CRON: Claims diários foram resetados para ${usersResetCount} usuário(s) no fuso de Maputo.`);
        } else {
            console.log('CRON: Nenhum usuário precisou ter seus claims diários resetados no fuso de Maputo.');
        }
    } catch (error) {
        console.error('CRON ERROR: Erro no job de reset de claims diários (Maputo):', error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Maputo"
});

// 6.2. Publicar Posts Agendados (Existente)
cron.schedule('*/5 * * * *', async () => {
    // console.log('CRON: Verificando posts de blog agendados...'); // Pode ser muito verboso
    try {
        const now = new Date();
        const postsToPublish = await BlogPost.find({
            status: 'scheduled',
            publishedAt: { $lte: now }
        });

        if (postsToPublish.length > 0) {
            for (const post of postsToPublish) {
                post.status = 'published';
                if (!post.publishedAt || new Date(post.publishedAt) > now) { // Garante que publishedAt não seja no futuro
                    post.publishedAt = now;
                }
                post.updatedAt = now;
                await post.save();
                console.log(`CRON: Post do blog "${post.title}" (ID: ${post._id}) publicado via agendamento.`);
            }
            // console.log(`CRON: ${postsToPublish.length} post(s) do blog foram publicados.`);
        }
    } catch (error) {
        console.error('CRON ERROR: Erro no job de publicação de posts agendados:', error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Maputo"
});

// NOVO: 6.3. Processar Expiração de Planos de Investimento Ativos
cron.schedule('5 0 * * *', async () => { // Roda todo dia às 00:05
    console.log('CRON: Iniciando verificação de expiração de planos de investimento...');
    const now = new Date();
    try {
        const users = await User.find({
            'activeInvestments.expiresAt': { $lte: now }
        });

        let plansExpiredCount = 0;
        for (const user of users) {
            let userModified = false;
            const stillActiveInvestments = [];
            for (const investment of user.activeInvestments) {
                if (investment.expiresAt && new Date(investment.expiresAt) <= now) {
                    console.log(`CRON: Plano "${investment.planName}" (ID: ${investment.planId}) do usuário ${user.email} (ID: ${user._id}) expirou em ${investment.expiresAt}.`);
                    // O plano é removido da lista de investimentos ativos
                    userModified = true;
                    plansExpiredCount++;
                    // Poderia adicionar uma notificação para o usuário aqui ou mover para um histórico de planos expirados
                } else {
                    stillActiveInvestments.push(investment);
                }
            }

            if (userModified) {
                user.activeInvestments = stillActiveInvestments;
                await user.save();
            }
        }

        if (plansExpiredCount > 0) {
            console.log(`CRON: ${plansExpiredCount} plano(s) de investimento ativo(s) foram processados como expirados.`);
        } else {
            console.log('CRON: Nenhum plano de investimento ativo expirou nesta verificação.');
        }
    } catch (error) {
        console.error('CRON ERROR: Erro no job de expiração de planos:', error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Maputo"
});


// NOVO: 6.4. Calcular e Pagar Comissões Diárias sobre Claims
cron.schedule('10 0 * * *', async () => { // Roda todo dia às 00:10, após o reset dos claims
    console.log('CRON: Iniciando cálculo de comissões diárias sobre claims...');
    const siteConfig = await getSiteSettings();
    if (!siteConfig.isReferralCommissionOnClaimsActive || !siteConfig.referralCommissionOnClaimsPercentage || siteConfig.referralCommissionOnClaimsPercentage <= 0) {
        console.log('CRON: Comissão de referência sobre claims está inativa ou percentagem não configurada. Pulando.');
        return;
    }

    const commissionPercentage = parseFloat(siteConfig.referralCommissionOnClaimsPercentage);
    const today = new Date();
    const yesterdayStart = new Date(today);
    yesterdayStart.setDate(today.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0); // Início do dia anterior

    const yesterdayEnd = new Date(today);
    yesterdayEnd.setDate(today.getDate() - 1);
    yesterdayEnd.setHours(23, 59, 59, 999); // Fim do dia anterior

    try {
        // Encontrar todos os históricos de referência ativos onde o referenciador deve receber comissão
        const activeReferrals = await ReferralHistory.find({
            // status: 'Comissão Paga', // Ou um status que indique que a comissão de registro já foi, e agora é sobre claims
            firstPlanActivatedByReferred: { $ne: null } // Garante que o indicado já ativou um plano
        }).populate('referrerId', 'email balance totalCommissionEarned')
          .populate('referredId', 'email claimHistory activeInvestments');

        if (!activeReferrals.length) {
            console.log('CRON: Nenhuma referência ativa encontrada para processar comissões de claims.');
            return;
        }

        let commissionsPaidCount = 0;
        let totalCommissionAmountPaid = 0;

        for (const refHistory of activeReferrals) {
            const referrer = refHistory.referrerId;
            const referred = refHistory.referredId;

            if (!referrer || !referred) {
                console.warn(`CRON: Referenciador ou indicado não encontrado para o histórico ID: ${refHistory._id}. Pulando.`);
                continue;
            }
            
            // Verificar se o plano do indicado ainda está ativo
            // (Essa verificação pode ser mais complexa, dependendo se a comissão continua após o plano do indicado expirar)
            // Por agora, vamos assumir que a comissão só é paga se o indicado tem planos ativos.
            const referredHasActiveNonExpiredPlans = referred.activeInvestments.some(inv => !inv.expiresAt || new Date(inv.expiresAt) > yesterdayStart);
            if (!referredHasActiveNonExpiredPlans) {
                // console.log(`CRON: Indicado ${referred.email} não possui planos ativos ou não expirados. Sem comissão de claims para ${referrer.email}.`);
                continue;
            }

            // Soma dos claims feitos pelo USUÁRIO INDICADO no DIA ANTERIOR
            let totalClaimsAmountByReferredYesterday = 0;
            for (const claim of referred.claimHistory) {
                const claimDate = new Date(claim.claimedAt);
                if (claimDate >= yesterdayStart && claimDate <= yesterdayEnd) {
                    totalClaimsAmountByReferredYesterday += claim.amount;
                }
            }

            if (totalClaimsAmountByReferredYesterday > 0) {
                // Verificar se já foi pago para este dia para este par referrer/referred
                 const existingLog = await DailyClaimCommissionLog.findOne({
                    referralHistoryId: refHistory._id,
                    date: yesterdayStart // Compara com o início do dia de ontem
                });

                if (existingLog) {
                    // console.log(`CRON: Comissão de claims para ${referrer.email} referente a ${referred.email} para ${yesterdayStart.toISOString().slice(0,10)} já processada.`);
                    continue;
                }

                const commissionEarned = parseFloat((totalClaimsAmountByReferredYesterday * commissionPercentage).toFixed(2));

                if (commissionEarned > 0) {
                    referrer.balance.MT = (referrer.balance.MT || 0) + commissionEarned;
                    referrer.totalCommissionEarned = (referrer.totalCommissionEarned || 0) + commissionEarned;
                    
                    const logEntry = new DailyClaimCommissionLog({
                        referrerId: referrer._id,
                        referredId: referred._id,
                        referralHistoryId: refHistory._id,
                        totalClaimsAmountByReferred: totalClaimsAmountByReferredYesterday,
                        commissionPercentageApplied: commissionPercentage,
                        commissionEarned: commissionEarned,
                        date: yesterdayStart, // Data do dia dos claims
                        paidAt: new Date()    // Data do pagamento da comissão
                    });

                    // Atualizar last paid date no referral history para evitar reprocessamento fácil
                    refHistory.dailyClaimCommissionLastPaidAt = new Date();
                    
                    await referrer.save();
                    await logEntry.save();
                    await refHistory.save();

                    commissionsPaidCount++;
                    totalCommissionAmountPaid += commissionEarned;
                    console.log(`CRON: Comissão de claims de ${commissionEarned.toFixed(2)} MT paga a ${referrer.email} pelos claims de ${referred.email} de ontem.`);
                }
            }
        }

        if (commissionsPaidCount > 0) {
            console.log(`CRON: ${commissionsPaidCount} comissões de claims pagas, totalizando ${totalCommissionAmountPaid.toFixed(2)} MT.`);
        } else {
            console.log('CRON: Nenhuma nova comissão de claims a ser paga nesta execução.');
        }

    } catch (error) {
        console.error('CRON ERROR: Erro no job de cálculo de comissões diárias sobre claims:', error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Maputo"
});


// -----------------------------------------------------------------------------
// 7. ROTAS DE AUTENTICAÇÃO
// -----------------------------------------------------------------------------
const authRouter = express.Router();

// 7.1. Rota de Cadastro (POST /api/auth/register) - ATUALIZADA
authRouter.post('/register', async (req, res) => {
    const { name, email, password, securityQuestion, securityAnswer, referralCode: referredByCode } = req.body;

    if (!name || !email || !password || !securityQuestion || !securityAnswer) {
        return res.status(400).json({ message: 'Todos os campos obrigatórios devem ser preenchidos.' });
    }
    if (password.length < 6) {
        return res.status(400).json({ message: 'A senha deve ter pelo menos 6 caracteres.' });
    }

    try {
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(409).json({ message: 'Este email já está cadastrado.' });
        }

        let referrer = null;
        if (referredByCode) {
            referrer = await User.findOne({ referralCode: referredByCode.toUpperCase() });
            if (!referrer) {
                return res.status(400).json({ message: 'Código de referência inválido.' });
            }
            if (referrer.isBlocked) { // Opcional: não permitir registro por referenciador bloqueado
                return res.status(400).json({ message: 'Código de referência pertence a um usuário indisponível.' });
            }
        }

        const siteConfig = await getSiteSettings();
        let calculatedRegistrationBonus = 0; // Bônus para o NOVO usuário
        if (siteConfig.isRegistrationBonusActive === true) {
            const bonusAmountSetting = siteConfig.registrationBonusAmount;
            if (typeof bonusAmountSetting === 'number' && bonusAmountSetting >= 0) {
                calculatedRegistrationBonus = bonusAmountSetting;
            } else {
                console.warn(`AVISO: Bônus de cadastro está ativo, mas 'registrationBonusAmount' (${bonusAmountSetting}) não é válido. Bônus definido como 0.`);
            }
        }

        const newUser = new User({
            name,
            email: email.toLowerCase(),
            password,
            securityQuestion,
            securityAnswer,
            referredBy: referrer ? referrer._id : null,
            balance: { MT: 0 },
            bonusBalance: calculatedRegistrationBonus, // Bônus de cadastro para o novo usuário
            totalCommissionEarned: 0
        });

        await newUser.save();

        // Cria o registro no Histórico de Referência se houver um referenciador
        // A comissão SÓ SERÁ PAGA ao referenciador quando o NOVO USUÁRIO (referredId) fizer o primeiro depósito E ATIVAR UM PLANO.
        if (referrer) {
            const referralEntry = new ReferralHistory({
                referrerId: referrer._id,
                referredId: newUser._id,
                status: 'Pendente', // Muda para 'Comissão Paga' após o indicado ativar o primeiro plano
                commissionEarnedOnRegistration: 0, // Será calculado e atualizado depois
            });
            await referralEntry.save();
        }

        const token = generateToken(newUser._id, newUser.isAdmin);

        let successMessage = 'Usuário cadastrado com sucesso!';
        if (calculatedRegistrationBonus > 0) {
            successMessage += ` Bônus de ${calculatedRegistrationBonus} MT adicionado.`;
        }
        successMessage += ' Lembre-se de salvar sua pergunta e resposta de segurança.';

        res.status(201).json({
            message: successMessage,
            token,
            user: {
                id: newUser._id,
                name: newUser.name,
                email: newUser.email,
                referralCode: newUser.referralCode,
                isAdmin: newUser.isAdmin
            }
        });

    } catch (error) {
        console.error('Erro no cadastro:', error);
        if (error.code === 11000 && error.keyPattern && error.keyPattern.referralCode) {
            // Este erro é raro, mas pode acontecer se o código de referência gerado aleatoriamente colidir
            return res.status(500).json({ message: 'Erro ao gerar informações do usuário. Tente novamente.' });
        }
        res.status(500).json({ message: 'Erro interno do servidor ao tentar cadastrar.' });
    }
});

// 7.2. Rota de Login (POST /api/auth/login) - Inalterada (funcionalmente)
authRouter.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email e senha são obrigatórios.' });
    }

    try {
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password'); // Inclui a senha para comparação
        if (!user) {
            return res.status(401).json({ message: 'Credenciais inválidas (email não encontrado).' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciais inválidas (senha incorreta).' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
        }

        user.lastLoginAt = new Date();
        await user.save(); // Salva lastLoginAt sem reenviar a senha (já que não foi modificada aqui)

        const token = generateToken(user._id, user.isAdmin);

        res.json({
            message: 'Login bem-sucedido!',
            token,
            user: { // Não enviar a senha de volta, mesmo hasheada
                id: user._id,
                name: user.name,
                email: user.email,
                isAdmin: user.isAdmin,
                referralCode: user.referralCode
            }
        });

    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ message: 'Erro interno do servidor ao tentar fazer login.' });
    }
});
// 7.3. Rota para Informação de Recuperação de Senha (POST /api/auth/request-password-recovery) - Inalterada
authRouter.post('/request-password-recovery', (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: "Email é obrigatório." });
    }
    // Esta lógica permanece como instrução, pois a redefinição é assistida pelo admin
    console.log(`Solicitação de recuperação de senha para: ${email}`);
    res.status(200).json({
        message: "Para recuperar sua senha, por favor, entre em contato com o administrador da plataforma e forneça seu email e a resposta para sua pergunta de segurança. O administrador irá guiá-lo no processo."
    });
});

// 7.4. Rota para Redefinir Senha com Token (POST /api/auth/reset-password/:token) - Inalterada
authRouter.post('/reset-password/:token', async (req, res) => {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
        return res.status(400).json({ message: 'A nova senha é obrigatória e deve ter pelo menos 6 caracteres.' });
    }

    try {
        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.status(400).json({ message: 'Token de redefinição de senha inválido ou expirado.' });
        }

        user.password = password; // O hook pre-save irá hashear
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ message: 'Senha redefinida com sucesso. Você já pode fazer login com sua nova senha.' });

    } catch (error) {
        console.error("Erro ao redefinir senha:", error);
        res.status(500).json({ message: 'Erro interno do servidor ao tentar redefinir a senha.' });
    }
});


app.use('/api/auth', authRouter);
// server.js (Continuação - PARTE 3)

// ... (Funções Utilitárias, Cron Jobs e Rotas de Autenticação da Parte 2) ...

// -----------------------------------------------------------------------------
// 8. ROTAS PÚBLICAS (Não requerem autenticação)
// -----------------------------------------------------------------------------
const publicRouter = express.Router();

// 8.1. Listar Planos de Investimento Ativos (GET /api/public/plans) - ATUALIZADA
publicRouter.get('/plans', async (req, res) => {
    try {
        const plans = await Plan.find({ isActive: true })
            .populate('category', 'name slug') // Popula a categoria do plano
            .sort({ 'category.order': 1, order: 1, investmentAmount: 1 }); // Ordena por categoria e depois pelo plano

        res.json(plans.map(plan => ({
            id: plan._id,
            name: plan.name,
            investmentAmount: plan.investmentAmount,
            dailyProfitRate: plan.dailyProfitRate,
            dailyProfitAmount: plan.dailyProfitAmount,
            claimValue: plan.claimValue,
            claimsPerDay: plan.claimsPerDay,
            description: plan.description,
            imageUrl: plan.imageUrl, // Se for local, o frontend precisará prefixar com a URL base do servidor
            tags: plan.tags,
            order: plan.order,
            // NOVOS CAMPOS DE DURAÇÃO E CATEGORIA
            durationValue: plan.durationValue,
            durationType: plan.durationType,
            category: plan.category ? {
                name: plan.category.name,
                slug: plan.category.slug
            } : null,
        })));
    } catch (error) {
        console.error("Erro ao buscar planos:", error);
        res.status(500).json({ message: "Erro ao buscar planos de investimento." });
    }
});

// NOVO: 8.1.A. Listar Categorias de Planos de Investimento (GET /api/public/plan-categories)
publicRouter.get('/plan-categories', async (req, res) => {
    try {
        // Listar apenas categorias que têm planos ativos associados
        const activeCategories = await Plan.aggregate([
            { $match: { isActive: true, category: { $ne: null } } },
            { $group: { _id: '$category' } },
            {
                $lookup: {
                    from: 'plancategories', // Nome da coleção para PlanCategory
                    localField: '_id',
                    foreignField: '_id',
                    as: 'categoryDetails'
                }
            },
            { $unwind: '$categoryDetails' },
            {
                $project: {
                    id: '$categoryDetails._id',
                    name: '$categoryDetails.name',
                    slug: '$categoryDetails.slug',
                    description: '$categoryDetails.description',
                    order: '$categoryDetails.order'
                }
            },
            { $sort: { order: 1, name: 1 } }
        ]);

        // Se quiser listar todas as categorias, independente de terem planos ativos:
        // const categories = await PlanCategory.find().sort({ order: 1, name: 1 });
        // res.json(categories.map(cat => ({
        //     id: cat._id,
        //     name: cat.name,
        //     slug: cat.slug,
        //     description: cat.description,
        //     order: cat.order
        // })));

        res.json(activeCategories);
    } catch (error) {
        console.error("Erro ao buscar categorias de planos:", error);
        res.status(500).json({ message: "Erro ao buscar categorias de planos." });
    }
});


// 8.2. Buscar Configurações Públicas do Site (GET /api/public/site-settings) - ATUALIZADA (para novas chaves, se aplicável)
publicRouter.get('/site-settings', async (req, res) => {
    try {
        const allSettings = await getSiteSettings();
        // Defina aqui quais configurações são consideradas públicas
        const publicSettings = {
            siteName: allSettings.siteName || "GoldMT Invest",
            contactTextLogin: allSettings.contactTextLogin,
            contactTextRegister: allSettings.contactTextRegister,
            contactTextPanel: allSettings.contactTextPanel,
            withdrawalFeeInfo: allSettings.withdrawalFeeInfo,
            minWithdrawalAmount: allSettings.minWithdrawalAmount,
            maxWithdrawalAmount: allSettings.maxWithdrawalAmount,
            // Adicionar outras configurações públicas conforme necessário
            // Ex: allowedClaimCurrencies, se o frontend precisar antes do login
            allowedClaimCurrencies: allSettings.allowedClaimCurrencies || ["MT"],
            // Poderia expor se o bônus de registro está ativo, mas não o valor.
            isRegistrationBonusActive: allSettings.isRegistrationBonusActive,
        };
        res.json(publicSettings);
    } catch (error) {
        console.error("Erro ao buscar configurações públicas do site:", error);
        res.status(500).json({ message: "Erro ao buscar configurações do site." });
    }
});

// 8.3. Rota para dados fictícios da página inicial (GET /api/public/fake-activity) - Inalterada
publicRouter.get('/fake-activity', (req, res) => {
    const activities = [
        { user: "Usuário A.", action: "depositou", amount: "750 MT", icon: "fa-arrow-down" },
        { user: "Investidor B.", action: "investiu no Plano Ouro", amount: "", icon: "fa-chart-line" },
        { user: "Cliente C.", action: "levantou", amount: "300 MT", icon: "fa-arrow-up" },
        { user: "Membro D.", action: "completou um claim de", amount: "79.70 MT", icon: "fa-check-circle" },
        { user: "Usuário E.", action: "registrou-se e ganhou", amount: "200 MT", icon: "fa-user-plus" }, // O bônus de cadastro
        { user: "Investidor F.", action: "depositou", amount: "15000 MT", icon: "fa-arrow-down" },
        { user: "Cliente G.", action: "convidou um amigo", amount: "", icon: "fa-users" }, // Comissões de referência são mais complexas agora
    ];
    const shuffled = activities.sort(() => 0.5 - Math.random());
    res.json(shuffled.slice(0, Math.floor(Math.random() * 3) + 3)); // Mostra de 3 a 5 atividades
});

// 8.4. Listar Banners da Homepage Ativos (GET /api/public/homepage-banners) - ATUALIZADA
publicRouter.get('/homepage-banners', async (req, res) => {
    try {
        const banners = await HomepageBanner.find({ isActive: true })
            .sort({ order: 1, createdAt: -1 });

        res.json(banners.map(banner => {
            let mediaUrl = banner.mediaUrl;
            if (banner.isLocalFile && mediaUrl && !mediaUrl.startsWith('http')) {
                // O frontend precisará adicionar a URL base do servidor se não for absoluta
                // Ex: `${process.env.BACKEND_URL_FOR_FRONTEND || ''}${mediaUrl}`
                // Por enquanto, apenas retornamos o path salvo.
            }
            return {
                id: banner._id,
                title: banner.title,
                mediaType: banner.mediaType,
                mediaUrl: mediaUrl, // O frontend tratará de prefixar se necessário
                videoPlatform: banner.videoPlatform,
                textOverlay: banner.textOverlay,
                ctaText: banner.ctaText,
                ctaLink: banner.ctaLink,
                // backgroundColor: banner.backgroundColor, // REMOVIDO
                textColor: banner.textColor,
                isLocalFile: banner.isLocalFile
            };
        }));
    } catch (error) {
        console.error("Erro ao buscar banners da homepage:", error);
        res.status(500).json({ message: "Erro ao buscar banners da homepage." });
    }
});

// 8.5. Rotas Públicas do Blog - ATUALIZADAS para coverImage local
const blogPublicRouter = express.Router();

blogPublicRouter.get('/posts', async (req, res) => {
    const { page = 1, limit = 10, search = '', category, tag, featured } = req.query;
    const query = {
        status: 'published',
        publishedAt: { $lte: new Date() }
    };

    if (search) {
        query.$or = [
            { title: { $regex: search, $options: 'i' } },
            { excerpt: { $regex: search, $options: 'i' } }
        ];
    }
    if (featured === 'true') query.isFeatured = true;

    try {
        if (category) {
            const cat = await BlogCategory.findOne({ slug: category.toLowerCase() });
            if (cat) query.category = cat._id;
            else return res.json({ posts: [], totalPages: 0, currentPage: parseInt(page), totalCount: 0 });
        }
        if (tag) {
            const tg = await BlogTag.findOne({ slug: tag.toLowerCase() });
            if (tg) query.tags = tg._id; // Assume que 'tags' é um array de IDs no BlogPost
            else return res.json({ posts: [], totalPages: 0, currentPage: parseInt(page), totalCount: 0 });
        }

        const posts = await BlogPost.find(query)
            .populate('category', 'name slug')
            .populate('tags', 'name slug')
            .populate('author', 'name')
            .sort({ isFeatured: -1, publishedAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .select('title slug excerpt coverImage isCoverImageLocal category tags author publishedAt isFeatured views');

        const totalPosts = await BlogPost.countDocuments(query);

        const formattedPosts = posts.map(post => {
            let coverImageUrl = post.coverImage;
            // if (post.isCoverImageLocal && coverImageUrl && !coverImageUrl.startsWith('http')) {
                // O frontend precisará adicionar a URL base do servidor
            // }
            return {
                title: post.title,
                slug: post.slug,
                excerpt: post.excerpt,
                coverImage: coverImageUrl,
                isCoverImageLocal: post.isCoverImageLocal,
                category: post.category ? { name: post.category.name, slug: post.category.slug } : null,
                tags: post.tags.map(t => ({ name: t.name, slug: t.slug })),
                author: post.author ? post.author.name : 'Autor Desconhecido',
                publishedAt: post.publishedAt,
                isFeatured: post.isFeatured,
                views: post.views
            };
        });

        res.json({
            posts: formattedPosts,
            totalPages: Math.ceil(totalPosts / limit),
            currentPage: parseInt(page),
            totalCount: totalPosts
        });
    } catch (error) {
        console.error("Público - Erro ao listar posts do blog:", error);
        res.status(500).json({ message: "Erro ao listar posts." });
    }
});

blogPublicRouter.get('/posts/:slug', async (req, res) => {
    try {
        const post = await BlogPost.findOneAndUpdate(
            { slug: req.params.slug.toLowerCase(), status: 'published', publishedAt: { $lte: new Date() } },
            { $inc: { views: 1 } },
            { new: true }
        )
        .populate('category', 'name slug')
        .populate('tags', 'name slug')
        .populate('author', 'name');

        if (!post) {
            return res.status(404).json({ message: "Post não encontrado ou não publicado." });
        }

        let coverImageUrl = post.coverImage;
        // if (post.isCoverImageLocal && coverImageUrl && !coverImageUrl.startsWith('http')) {
            // O frontend precisará adicionar a URL base do servidor
        // }

        const publicPost = {
            title: post.title, slug: post.slug, content: post.content, excerpt: post.excerpt,
            coverImage: coverImageUrl, isCoverImageLocal: post.isCoverImageLocal,
            category: post.category ? { name: post.category.name, slug: post.category.slug } : null,
            tags: post.tags.map(t => ({ name: t.name, slug: t.slug })),
            author: post.author ? post.author.name : 'Autor Desconhecido',
            publishedAt: post.publishedAt, isFeatured: post.isFeatured, views: post.views,
            seoTitle: post.seoTitle, seoDescription: post.seoDescription, seoKeywords: post.seoKeywords
        };
        res.json(publicPost);
    } catch (error) {
        console.error("Público - Erro ao buscar post do blog:", error);
        res.status(500).json({ message: "Erro ao buscar post." });
    }
});

// Rotas para listar categorias e tags do blog permanecem funcionalmente as mesmas
blogPublicRouter.get('/categories', async (req, res) => {
    try {
        const categoriesWithPosts = await BlogPost.aggregate([
            { $match: { status: 'published', publishedAt: { $lte: new Date() }, category: { $ne: null } } },
            { $group: { _id: '$category', postCount: { $sum: 1 } } },
            { $lookup: { from: 'blogcategories', localField: '_id', foreignField: '_id', as: 'categoryDetails' } },
            { $unwind: '$categoryDetails' },
            { $project: { _id: '$categoryDetails._id', name: '$categoryDetails.name', slug: '$categoryDetails.slug', description: '$categoryDetails.description', postCount: 1 } },
            { $sort: { name: 1 } }
        ]);
        res.json(categoriesWithPosts);
    } catch (error) {
        console.error("Público - Erro ao listar categorias do blog:", error);
        res.status(500).json({ message: "Erro ao listar categorias." });
    }
});

blogPublicRouter.get('/tags', async (req, res) => {
    try {
        const tagsWithPosts = await BlogPost.aggregate([
            { $match: { status: 'published', publishedAt: { $lte: new Date() }, tags: { $ne: [] } } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', postCount: { $sum: 1 } } },
            { $lookup: { from: 'blogtags', localField: '_id', foreignField: '_id', as: 'tagDetails' } },
            { $unwind: '$tagDetails' },
            { $project: { _id: '$tagDetails._id', name: '$tagDetails.name', slug: '$tagDetails.slug', postCount: 1 } },
            { $sort: { name: 1 } }
        ]);
        res.json(tagsWithPosts);
    } catch (error) {
        console.error("Público - Erro ao listar tags do blog:", error);
        res.status(500).json({ message: "Erro ao listar tags." });
    }
});

publicRouter.use('/blog', blogPublicRouter);
app.use('/api/public', publicRouter);
// server.js (Continuação - PARTE 4)

// ... (Rotas Públicas da Parte 3) ...

// -----------------------------------------------------------------------------
// 9. ROTAS DO USUÁRIO AUTENTICADO
// -----------------------------------------------------------------------------
const userRouter = express.Router();
userRouter.use(authenticateToken); // Middleware de autenticação para todas as rotas de usuário

// 9.1. Obter Dados do Painel do Usuário (GET /api/user/dashboard) - ATUALIZADA
userRouter.get('/dashboard', async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password -securityAnswer -securityQuestion -resetPasswordToken -resetPasswordExpires')
            .populate({
                path: 'activeInvestments.planId',
                select: 'name claimsPerDay imageUrl category', // Adicionar mais campos do plano se necessário
                populate: { path: 'category', select: 'name slug'}
            })
            .populate('referredBy', 'name email');

        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }

        const totalMainBalance = user.balance.MT || 0;
        const totalBonusBalance = user.bonusBalance || 0;
        const totalBalance = totalMainBalance + totalBonusBalance; // Saldo de referência foi removido

        const activeInvestmentsDetails = user.activeInvestments.map(inv => {
            let planCategory = null;
            if (inv.planId && inv.planId.category) {
                planCategory = {
                    name: inv.planId.category.name,
                    slug: inv.planId.category.slug
                };
            }
            return {
                id: inv._id, // ID do investimento ativo específico do usuário
                planId: inv.planId ? inv.planId._id : null, // ID do Plano (modelo)
                planName: inv.planName,
                planImage: inv.planId ? inv.planId.imageUrl : null,
                planCategory: planCategory,
                investedAmount: inv.investedAmount,
                dailyProfitAmount: inv.dailyProfitAmount,
                claimValue: inv.claimValue,
                claimsMadeToday: inv.claimsMadeToday,
                claimsPerDay: (inv.planId && inv.planId.claimsPerDay) || 5,
                activatedAt: inv.activatedAt,
                expiresAt: inv.expiresAt, // NOVO: Mostrar data de expiração
            };
        });

        const claimHistoryDetails = user.claimHistory
            .sort((a, b) => new Date(b.claimedAt) - new Date(a.claimedAt))
            .slice(0, 20) // Limita a 20 registros recentes
            .map(claim => ({
                planName: claim.planName,
                amount: claim.amount,
                currency: claim.currency,
                claimedAt: claim.claimedAt,
                claimNumber: claim.claimNumber
            }));

        const deposits = await Deposit.find({ userId: req.user.id })
            .sort({ requestedAt: -1 })
            .limit(10)
            .select('amount method status requestedAt');

        // Contagem de referências e ganhos totais de comissão (campo totalCommissionEarned no User)
        const referralsMadeCount = await ReferralHistory.countDocuments({ referrerId: req.user.id });
        const successfulReferrals = await ReferralHistory.countDocuments({ referrerId: req.user.id, status: 'Comissão Paga' });

        const now = new Date();
        const relevantNotificationsForUser = await Notification.find({
            isActive: true,
            $or: [ { targetAudience: 'all' }, { targetAudience: 'specificUser', targetUserId: user._id } ],
            $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } } ]
        }).select('_id'); // Apenas IDs para contagem
        const relevantNotificationIdsForUser = relevantNotificationsForUser.map(n => n._id);

        let unreadNotificationCount = 0;
        if (relevantNotificationIdsForUser.length > 0) {
            // Garante que o status do usuário exista para estas notificações antes de contar
            // (Opcional: pode ser feito na rota de notificações)
            for (const notificationId of relevantNotificationIdsForUser) {
                await UserNotificationStatus.updateOne(
                    { userId: user._id, notificationId: notificationId },
                    { $setOnInsert: { userId: user._id, notificationId: notificationId, isRead: false, isDeleted: false, createdAt: new Date() } },
                    { upsert: true }
                );
            }
            unreadNotificationCount = await UserNotificationStatus.countDocuments({
                userId: user._id,
                notificationId: { $in: relevantNotificationIdsForUser },
                isRead: false,
                isDeleted: false
            });
        }
        
        const siteConfig = await getSiteSettings(); // Para allowedClaimCurrencies

        res.json({
            name: user.name,
            email: user.email,
            referralCode: user.referralCode, // Apenas o código
            // referralLink: `${FRONTEND_URL}/register?ref=${user.referralCode}`, // O frontend pode construir isso
            totalBalance: parseFloat(totalBalance.toFixed(2)),
            mainBalanceMT: parseFloat(totalMainBalance.toFixed(2)),
            bonusBalance: parseFloat(totalBonusBalance.toFixed(2)),
            totalCommissionEarned: parseFloat((user.totalCommissionEarned || 0).toFixed(2)), // Total de comissões ganhas
            activeInvestments: activeInvestmentsDetails,
            claimHistory: claimHistoryDetails,
            deposits: deposits,
            referrals: {
                count: referralsMadeCount,
                successfulCount: successfulReferrals, // Que resultaram em comissão de registro paga
                // totalEarned agora é user.totalCommissionEarned
            },
            unreadNotificationCount: unreadNotificationCount,
            firstDepositMade: user.firstDepositMade,
            isBlocked: user.isBlocked,
            allowedClaimCurrencies: siteConfig.allowedClaimCurrencies || ["MT", "BTC", "ETH", "USDT"]
        });

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard:", error);
        res.status(500).json({ message: "Erro ao buscar dados do painel." });
    }
});

// 9.2. Solicitar Depósito (POST /api/user/deposits) - Inalterada, mas a confirmação pelo Admin terá nova lógica
userRouter.post('/deposits', async (req, res) => {
    const { amount, method, transactionIdOrConfirmationMessage, paymentDetailsUsed } = req.body;

    if (!amount || !method || !transactionIdOrConfirmationMessage || !paymentDetailsUsed) {
        return res.status(400).json({ message: "Valor, método, mensagem de confirmação e detalhes do pagamento são obrigatórios." });
    }
    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({ message: "Valor do depósito inválido." });
    }

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const siteConfig = await getSiteSettings();
        const activePaymentMethods = siteConfig.paymentMethods || []; // Espera que paymentMethods seja um array de objetos
        const chosenMethodConfig = activePaymentMethods.find(pm => pm.name === method && pm.isActive);

        if (!chosenMethodConfig) {
            return res.status(400).json({ message: `Método de pagamento '${method}' não está ativo ou não existe.` });
        }

        const deposit = new Deposit({
            userId: req.user.id,
            amount: parseFloat(amount),
            method,
            transactionIdOrConfirmationMessage,
            paymentDetailsUsed, // Detalhes usados pelo usuário para pagar (ex: conta de origem)
            status: 'Pendente'
        });
        await deposit.save();

        res.status(201).json({ message: "Solicitação de depósito recebida. Aguardando confirmação do administrador.", deposit });

    } catch (error) {
        console.error("Erro ao solicitar depósito:", error);
        res.status(500).json({ message: "Erro ao processar solicitação de depósito." });
    }
});

// 9.3. Listar Depósitos do Usuário (GET /api/user/deposits) - Inalterada
userRouter.get('/deposits', async (req, res) => {
    try {
        const deposits = await Deposit.find({ userId: req.user.id }).sort({ requestedAt: -1 });
        res.json(deposits);
    } catch (error) {
        console.error("Erro ao buscar depósitos:", error);
        res.status(500).json({ message: "Erro ao buscar histórico de depósitos." });
    }
});

// 9.4. Obter Métodos de Depósito Ativos (GET /api/user/deposit-methods) - Inalterada
userRouter.get('/deposit-methods', async (req, res) => {
    try {
        const siteConfig = await getSiteSettings();
        const paymentMethods = (siteConfig.paymentMethods || [])
            .filter(pm => pm.isActive)
            .map(pm => ({ name: pm.name, details: pm.details, instructions: pm.instructions, type: pm.type }));
        res.json(paymentMethods);
    } catch (error) {
        console.error("Erro ao buscar métodos de depósito:", error);
        res.status(500).json({ message: "Erro ao buscar métodos de depósito." });
    }
});

// 9.5. Realizar Claim (POST /api/user/claims) - ATUALIZADA para verificar expiração do investimento
userRouter.post('/claims', async (req, res) => {
    const { investmentId, currencyForClaim } = req.body; // investmentId é o ID do activeInvestmentSchema

    if (!investmentId || !currencyForClaim) {
        return res.status(400).json({ message: "ID do investimento e moeda do claim são obrigatórios." });
    }

    const siteConfig = await getSiteSettings();
    const allowedClaimCurrencies = siteConfig.allowedClaimCurrencies || ["MT", "BTC", "ETH", "USDT"];
    if (!allowedClaimCurrencies.includes(currencyForClaim.toUpperCase())) {
        return res.status(400).json({ message: `Moeda de claim '${currencyForClaim}' não é permitida.` });
    }

    try {
        const user = await User.findById(req.user.id).populate('activeInvestments.planId'); // Popula o plano original
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const investment = user.activeInvestments.id(investmentId);
        if (!investment) {
            return res.status(404).json({ message: "Investimento ativo não encontrado." });
        }
        if (!investment.planId) { // Checagem de consistência
            return res.status(500).json({ message: "Dados do plano associado ao investimento corrompidos."});
        }

        // VERIFICAR SE O INVESTIMENTO ATIVO EXPIROU
        if (investment.expiresAt && new Date() > new Date(investment.expiresAt)) {
            return res.status(400).json({ message: "Este plano de investimento expirou. Não é possível realizar mais claims." });
        }

        // Lógica de reset de claims diários (o cron job faz isso, mas uma verificação aqui pode ser útil)
        const todayMidnight = new Date();
        todayMidnight.setHours(0,0,0,0); // Fuso horário do servidor
        // Idealmente, usar o mesmo fuso do cron ('Africa/Maputo') para consistência se o servidor estiver em outro fuso.
        // Esta verificação local é um fallback, o cron é a fonte primária de reset.
        if (investment.lastClaimDate && new Date(investment.lastClaimDate) < todayMidnight && investment.claimsMadeToday > 0) {
            // Se o último claim foi antes da meia-noite de hoje e ainda há claimsMadeToday, resetar.
            // No entanto, o cron job deve ter tratado isso. Se chegou aqui, pode indicar uma diferença de fuso ou um cron falho.
            console.warn(`Aviso: claimsMadeToday para o investimento ${investmentId} do usuário ${user.email} não foi resetado pelo cron como esperado. Resetando agora.`);
            investment.claimsMadeToday = 0;
        }


        const maxClaimsPerDay = investment.planId.claimsPerDay || 5;
        if (investment.claimsMadeToday >= maxClaimsPerDay ) {
            return res.status(400).json({ message: "Você já realizou o número máximo de claims para este investimento hoje." });
        }

        const claimAmountMT = investment.claimValue;

        user.balance.MT = (user.balance.MT || 0) + claimAmountMT;

        investment.claimsMadeToday += 1;
        investment.lastClaimDate = new Date(); // Data/hora do claim atual

        const newClaimRecord = {
            planId: investment.planId._id,
            planName: investment.planName,
            claimNumber: investment.claimsMadeToday,
            amount: claimAmountMT,
            currency: currencyForClaim.toUpperCase(), // Moeda selecionada pelo usuário para REPRESENTAR o claim
            claimedAt: new Date()
        };
        user.claimHistory.push(newClaimRecord);

        await user.save();

        res.json({
            message: `Claim de ${claimAmountMT.toFixed(2)} MT (representado como ${currencyForClaim.toUpperCase()}) realizado com sucesso!`,
            claim: newClaimRecord,
            updatedBalanceMT: user.balance.MT,
            claimsMadeToday: investment.claimsMadeToday,
            investmentExpiresAt: investment.expiresAt
        });

    } catch (error) {
        console.error("Erro ao realizar claim:", error);
        res.status(500).json({ message: "Erro ao processar claim." });
    }
});

// 9.6. Listar Histórico de Claims do Usuário (GET /api/user/claims) - Inalterada
userRouter.get('/claims', async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('claimHistory').lean();
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const claimHistory = (user.claimHistory || [])
            .sort((a, b) => new Date(b.claimedAt) - new Date(a.claimedAt));

        res.json(claimHistory);
    } catch (error) {
        console.error("Erro ao buscar histórico de claims:", error);
        res.status(500).json({ message: "Erro ao buscar histórico de claims." });
    }
});

// 9.7. Solicitar Saque (POST /api/user/withdrawals) - ATUALIZADA (remoção do saldo de referência)
userRouter.post('/withdrawals', async (req, res) => {
    const { amount, withdrawalMethod, recipientInfo } = req.body;

    if (!amount || !withdrawalMethod || !recipientInfo) {
        return res.status(400).json({ message: "Valor, método de saque e informações do destinatário são obrigatórios." });
    }

    const withdrawalAmount = parseFloat(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
        return res.status(400).json({ message: "Valor de saque inválido." });
    }

    const siteConfig = await getSiteSettings();
    const MIN_WITHDRAWAL = siteConfig.minWithdrawalAmount || 50;
    const MAX_WITHDRAWAL = siteConfig.maxWithdrawalAmount || 50000;

    if (withdrawalAmount < MIN_WITHDRAWAL) {
        return res.status(400).json({ message: `O valor mínimo para saque é de ${MIN_WITHDRAWAL} MT.` });
    }
    if (withdrawalAmount > MAX_WITHDRAWAL) {
        return res.status(400).json({ message: `O valor máximo para saque é de ${MAX_WITHDRAWAL} MT.` });
    }

    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        if (!user.firstDepositMade) { // Regra de negócio: precisa de um depósito confirmado para sacar
            return res.status(403).json({ message: "Você precisa realizar pelo menos um depósito confirmado para solicitar saques." });
        }

        // Cálculo da taxa (lógica existente, pode ser ajustada)
        let feePercentage = parseFloat(siteConfig.withdrawalFeePercentageBase) || 0.02;
        // ... (lógica de limiares de taxa)
        if (withdrawalAmount > (parseFloat(siteConfig.withdrawalFeeHighValueThreshold1) || 10000)) feePercentage = parseFloat(siteConfig.withdrawalFeeHighValuePercentage1) || 0.05;
        if (withdrawalAmount > (parseFloat(siteConfig.withdrawalFeeHighValueThreshold2) || 25000)) feePercentage = parseFloat(siteConfig.withdrawalFeeHighValuePercentage2) || 0.10;
        if (['BTC', 'ETH', 'USDT'].includes(withdrawalMethod.toUpperCase())) { 
            feePercentage += (parseFloat(siteConfig.withdrawalFeeCryptoBonus) || 0.02);
        }
        feePercentage = Math.min(feePercentage, (parseFloat(siteConfig.withdrawalFeeMaxPercentage) || 0.15));

        const feeApplied = parseFloat((withdrawalAmount * feePercentage).toFixed(2));
        const netAmount = parseFloat((withdrawalAmount - feeApplied).toFixed(2));

        // Saldo disponível para saque (Saldo Principal MT + Saldo de Bônus)
        const availableBalanceForWithdrawal = (user.balance.MT || 0) + (user.bonusBalance || 0);

        if (withdrawalAmount > availableBalanceForWithdrawal) {
            return res.status(400).json({ message: `Saldo insuficiente. Disponível para saque (Principal + Bônus): ${availableBalanceForWithdrawal.toFixed(2)} MT.` });
        }

        // Deduzir do saldo, priorizando Saldo Principal, depois Saldo de Bônus
        let amountToDeduct = withdrawalAmount;

        const mainBalanceDeduction = Math.min(amountToDeduct, user.balance.MT || 0);
        user.balance.MT -= mainBalanceDeduction;
        amountToDeduct -= mainBalanceDeduction;

        if (amountToDeduct > 0) {
            const bonusBalanceDeduction = Math.min(amountToDeduct, user.bonusBalance || 0);
            user.bonusBalance -= bonusBalanceDeduction;
            // amountToDeduct -= bonusBalanceDeduction; // Não é mais necessário, pois não há outro saldo
        }
        // O saldo de referência foi removido, então não há mais dedução dele.

        await user.save();

        const withdrawal = new Withdrawal({
            userId: req.user.id,
            amount: withdrawalAmount,
            withdrawalMethod,
            recipientInfo,
            feeApplied,
            netAmount,
            status: 'Pendente'
        });
        await withdrawal.save();

        res.status(201).json({
            message: `Solicitação de saque de ${withdrawalAmount.toFixed(2)} MT enviada. Taxa: ${feeApplied.toFixed(2)} MT. Líquido: ${netAmount.toFixed(2)} MT.`,
            withdrawal
        });

    } catch (error) {
        console.error("Erro ao solicitar saque:", error);
        res.status(500).json({ message: "Erro ao processar solicitação de saque." });
    }
});

// 9.8. Listar Saques do Usuário (GET /api/user/withdrawals) - Inalterada
userRouter.get('/withdrawals', async (req, res) => {
    try {
        const withdrawals = await Withdrawal.find({ userId: req.user.id }).sort({ requestedAt: -1 });
        res.json(withdrawals);
    } catch (error) {
        console.error("Erro ao buscar saques:", error);
        res.status(500).json({ message: "Erro ao buscar histórico de saques." });
    }
});

// 9.9. Informações de Referência do Usuário (GET /api/user/referrals) - ATUALIZADA
userRouter.get('/referrals', async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('referralCode totalCommissionEarned');
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        // Busca o histórico de referências onde este usuário é o referenciador
        const referrals = await ReferralHistory.find({ referrerId: req.user.id })
            .populate('referredId', 'name email createdAt firstDepositMade') // Popula dados do usuário indicado
            .populate('firstPlanActivatedByReferred', 'name investmentAmount') // Popula o primeiro plano ativado pelo indicado
            .sort({ createdAt: -1 });

        res.json({
            referralCode: user.referralCode,
            referralLink: `${FRONTEND_URL}/register?ref=${user.referralCode}`, // O frontend pode construir isso também
            totalCommissionEarned: user.totalCommissionEarned || 0, // Comissão total (registro + claims)
            referralsList: referrals.map(r => ({
                referredUserName: r.referredId ? r.referredId.name : 'Usuário Deletado',
                referredUserEmail: r.referredId ? r.referredId.email : '-',
                referredUserRegisteredAt: r.referredId ? r.referredId.createdAt : null,
                referralStatus: r.status, // 'Pendente', 'Comissão Paga', 'Expirado'
                commissionEarnedOnRegistration: r.commissionEarnedOnRegistration,
                registrationCommissionPaidAt: r.registrationCommissionPaidAt,
                firstPlanActivated: r.firstPlanActivatedByReferred ? {
                    name: r.firstPlanActivatedByReferred.name,
                    amount: r.firstPlanActivatedByReferred.investmentAmount
                } : null,
                firstPlanActivationDate: r.firstPlanActivationDate,
                // Poderíamos adicionar um resumo de comissões de claims aqui, mas pode ser custoso.
                // O total já está no user.totalCommissionEarned.
            }))
        });
    } catch (error) {
        console.error("Erro ao buscar dados de referência:", error);
        res.status(500).json({ message: "Erro ao buscar dados de referência." });
    }
});

// 9.10. Listar Promoções Urgentes Ativas para o Usuário (GET /api/user/urgent-promotions) - Inalterada
// (Countdown é responsabilidade do frontend usando o expiresAt)
userRouter.get('/urgent-promotions', async (req, res) => {
    try {
        const now = new Date();
        const activePromotions = await UrgentPromotion.find({
            isActive: true,
            expiresAt: { $gte: now }
        }).sort({ createdAt: -1 });

        res.json(activePromotions.map(promo => ({
            id: promo._id,
            title: promo.title,
            image: promo.image, // Se for local, o frontend precisa tratar o path
            description: promo.description,
            expiresAt: promo.expiresAt,
            link: promo.link,
            badgeText: promo.badgeText,
            // isImageLocal: promo.isImageLocal (se adicionado ao schema de UrgentPromotion)
        })));
    } catch (error) {
        console.error("Erro ao buscar promoções urgentes para o usuário:", error);
        res.status(500).json({ message: "Erro ao buscar promoções urgentes." });
    }
});

// 9.11. Listar Notificações do Usuário (GET /api/user/notifications) - Funcionalmente inalterada, mas upsert no dashboard
userRouter.get('/notifications', async (req, res) => {
    const userId = req.user.id;
    const { page = 1, limit = 10, status = 'all' } = req.query; // status: 'all', 'read', 'unread'

    try {
        const now = new Date();
        // 1. Encontrar todas as notificações RELEVANTES para o usuário (ativas e não expiradas)
        const relevantGlobalNotifications = await Notification.find({
            isActive: true,
            targetAudience: 'all',
            $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } } ]
        }).select('_id');

        const relevantUserSpecificNotifications = await Notification.find({
            isActive: true,
            targetAudience: 'specificUser', targetUserId: userId,
            $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } } ]
        }).select('_id');
        
        const relevantNotificationIds = [
            ...relevantGlobalNotifications.map(n => n._id),
            ...relevantUserSpecificNotifications.map(n => n._id)
        ];
        
        // Remove duplicatas se uma notificação for 'all' e 'specificUser' (improvável, mas seguro)
        const uniqueRelevantNotificationIds = [...new Set(relevantNotificationIds.map(id => id.toString()))]
                                             .map(idStr => new mongoose.Types.ObjectId(idStr));

        if (uniqueRelevantNotificationIds.length === 0) {
            return res.json({ notifications: [], totalPages: 0, currentPage: parseInt(page), unreadCount: 0, totalCount: 0 });
        }

        // 2. Garantir que UserNotificationStatus exista para todas as notificações relevantes
        const upsertPromises = uniqueRelevantNotificationIds.map(notificationId =>
            UserNotificationStatus.updateOne(
                { userId: userId, notificationId: notificationId },
                { $setOnInsert: { userId: userId, notificationId: notificationId, isRead: false, isDeleted: false, createdAt: new Date() } },
                { upsert: true }
            )
        );
        await Promise.all(upsertPromises);

        // 3. Construir query para buscar os status
        let queryOptions = { userId: userId, notificationId: { $in: uniqueRelevantNotificationIds }, isDeleted: false };
        if (status === 'read') queryOptions.isRead = true;
        else if (status === 'unread') queryOptions.isRead = false;

        const totalUserNotifications = await UserNotificationStatus.countDocuments(queryOptions);
        const userStatuses = await UserNotificationStatus.find(queryOptions)
            .populate({
                path: 'notificationId',
                model: 'Notification',
                select: 'title message type createdAt expiresAt link'
            })
            .sort({ 'notificationId.createdAt': -1 }) // Ordena pela data de criação da notificação original
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        const unreadCount = await UserNotificationStatus.countDocuments({
            userId: userId, notificationId: { $in: uniqueRelevantNotificationIds }, isRead: false, isDeleted: false
        });

        res.json({
            notifications: userStatuses
                .filter(us => us.notificationId) // Filtra caso alguma notificação tenha sido deletada e o populate falhe
                .map(us => ({
                    userNotificationId: us._id, // ID do UserNotificationStatus
                    id: us.notificationId._id,  // ID da Notificação original
                    title: us.notificationId.title,
                    message: us.notificationId.message,
                    type: us.notificationId.type,
                    link: us.notificationId.link,
                    createdAt: us.notificationId.createdAt, // Data de criação da notificação
                    expiresAt: us.notificationId.expiresAt,
                    isRead: us.isRead,
                    readAt: us.readAt
            })),
            totalPages: Math.ceil(totalUserNotifications / limit),
            currentPage: parseInt(page),
            unreadCount: unreadCount,
            totalCount: totalUserNotifications
        });
    } catch (error) {
        console.error("Erro ao listar notificações do usuário:", error);
        res.status(500).json({ message: "Erro ao buscar notificações.", errorDetails: error.message });
    }
});

// 9.12. Marcar Notificações como Lidas (POST /api/user/notifications/mark-as-read) - Inalterada
userRouter.post('/notifications/mark-as-read', async (req, res) => {
    const userId = req.user.id;
    const { notificationStatusIds, markAllAsRead = false } = req.body; // notificationStatusIds são os IDs de UserNotificationStatus

    if (!markAllAsRead && (!Array.isArray(notificationStatusIds) || notificationStatusIds.length === 0)) {
        return res.status(400).json({ message: "Forneça IDs de status de notificação ou marque todas como lidas." });
    }
    try {
        let updateQuery = { userId: userId, isRead: false, isDeleted: false };
        if (!markAllAsRead) {
            updateQuery._id = { $in: notificationStatusIds.map(id => new mongoose.Types.ObjectId(id)) };
        }

        const result = await UserNotificationStatus.updateMany(updateQuery, { $set: { isRead: true, readAt: new Date() } });
        const modifiedCount = result.modifiedCount; 
        
        // Recalcular unreadCount
         const now = new Date();
        const relevantGlobalNotifications = await Notification.find({ isActive: true, targetAudience: 'all', $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } } ] }).select('_id');
        const relevantUserSpecificNotifications = await Notification.find({isActive: true, targetAudience: 'specificUser', targetUserId: userId, $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } } ]}).select('_id');
        const relevantNotificationIds = [...relevantGlobalNotifications.map(n => n._id), ...relevantUserSpecificNotifications.map(n => n._id)];
        const uniqueRelevantNotificationIds = [...new Set(relevantNotificationIds.map(id => id.toString()))].map(idStr => new mongoose.Types.ObjectId(idStr));
        
        const unreadCount = uniqueRelevantNotificationIds.length > 0 ? await UserNotificationStatus.countDocuments({
            userId: userId, notificationId: { $in: uniqueRelevantNotificationIds }, isRead: false, isDeleted: false
        }) : 0;

        res.json({ message: `${modifiedCount} notificação(ões) marcada(s) como lida(s).`, modifiedCount: modifiedCount, unreadCount: unreadCount });
    } catch (error) {
        console.error("Erro ao marcar notificações como lidas:", error);
        res.status(500).json({ message: "Erro ao atualizar notificações.", error: error.message });
    }
});

// 9.13. Deletar Notificação do Usuário (Soft Delete) (POST /api/user/notifications/delete) - Inalterada
userRouter.post('/notifications/delete', async (req, res) => {
    const userId = req.user.id;
    const { notificationStatusIds, deleteAll = false } = req.body; // notificationStatusIds são os IDs de UserNotificationStatus

    if (!deleteAll && (!Array.isArray(notificationStatusIds) || notificationStatusIds.length === 0)) {
        return res.status(400).json({ message: "Forneça IDs de status de notificação para deletar ou marque para deletar todas." });
    }
    try {
        let updateQuery = { userId: userId, isDeleted: false };
        if (!deleteAll) {
            updateQuery._id = { $in: notificationStatusIds.map(id => new mongoose.Types.ObjectId(id)) };
        }
        const result = await UserNotificationStatus.updateMany(updateQuery, { $set: { isDeleted: true, deletedAt: new Date(), isRead: true, readAt: new Date() } });
        const modifiedCount = result.modifiedCount;

        // Recalcular unreadCount
        const now = new Date();
        const relevantGlobalNotifications = await Notification.find({ isActive: true, targetAudience: 'all', $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } } ] }).select('_id');
        const relevantUserSpecificNotifications = await Notification.find({isActive: true, targetAudience: 'specificUser', targetUserId: userId, $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } } ]}).select('_id');
        const relevantNotificationIds = [...relevantGlobalNotifications.map(n => n._id), ...relevantUserSpecificNotifications.map(n => n._id)];
        const uniqueRelevantNotificationIds = [...new Set(relevantNotificationIds.map(id => id.toString()))].map(idStr => new mongoose.Types.ObjectId(idStr));

        const unreadCount = uniqueRelevantNotificationIds.length > 0 ? await UserNotificationStatus.countDocuments({
            userId: userId, notificationId: { $in: uniqueRelevantNotificationIds }, isRead: false, isDeleted: false
        }) : 0;

        res.json({ message: `${modifiedCount} notificação(ões) marcada(s) como deletada(s).`, modifiedCount: modifiedCount, unreadCount: unreadCount });
    } catch (error) {
        console.error("Erro ao deletar notificações do usuário:", error);
        res.status(500).json({ message: "Erro ao deletar notificações.", error: error.message });
    }
});

// 9.14. Ativar Plano com Saldo da Conta (POST /api/user/activate-plan-with-balance) - ATUALIZADA SIGNIFICATIVAMENTE
userRouter.post('/activate-plan-with-balance', async (req, res) => {
    const { planId } = req.body; // ID do modelo Plan
    const userId = req.user.id;

    if (!planId) {
        return res.status(400).json({ message: "ID do plano é obrigatório." });
    }

    try {
        const user = await User.findById(userId);
        const planToActivate = await Plan.findById(planId);
        const siteConfig = await getSiteSettings();

        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }
        if (!planToActivate || !planToActivate.isActive) {
            return res.status(404).json({ message: "Plano não encontrado ou está inativo." });
        }

        // Verifica se o usuário já tem este plano específico ativo (para evitar duplicidade se a regra de negócio for essa)
        // Se um usuário puder ter múltiplas instâncias do MESMO plano, essa verificação pode ser removida ou ajustada.
        const alreadyActiveWithThisPlanModel = user.activeInvestments.some(inv => inv.planId.equals(planToActivate._id) && (!inv.expiresAt || new Date(inv.expiresAt) > new Date()));
        if (alreadyActiveWithThisPlanModel) {
            return res.status(400).json({ message: `Você já possui o plano "${planToActivate.name}" ativo e não expirado.` });
        }

        const investmentAmount = planToActivate.investmentAmount;

        if ((user.balance.MT || 0) < investmentAmount) {
            return res.status(400).json({ 
                message: `Saldo MT insuficiente (${(user.balance.MT || 0).toFixed(2)}) para ativar o plano "${planToActivate.name}" (${investmentAmount.toFixed(2)} MT). Por favor, realize um depósito.`,
                redirectToDeposit: true // Para o frontend redirecionar
            });
        }

        // Deduzir valor do plano do saldo do usuário
        user.balance.MT -= investmentAmount;

        // Calcular data de expiração
        let expiresAt = null;
        if (planToActivate.durationType !== 'lifelong' && planToActivate.durationValue && planToActivate.durationValue > 0) {
            expiresAt = new Date();
            if (planToActivate.durationType === 'days') {
                expiresAt.setDate(expiresAt.getDate() + planToActivate.durationValue);
            } else if (planToActivate.durationType === 'weeks') {
                expiresAt.setDate(expiresAt.getDate() + (planToActivate.durationValue * 7));
            }
            expiresAt.setHours(23, 59, 59, 999); // Expira no final do dia calculado
        }

        const newInvestment = {
            planId: planToActivate._id,
            planName: planToActivate.name,
            investedAmount: investmentAmount,
            dailyProfitRate: planToActivate.dailyProfitRate,
            dailyProfitAmount: planToActivate.dailyProfitAmount,
            claimValue: planToActivate.claimValue,
            claimsMadeToday: 0,
            activatedAt: new Date(),
            expiresAt: expiresAt,
        };
        user.activeInvestments.push(newInvestment);
        
        // LÓGICA DE COMISSÃO DE REGISTRO PARA O REFERENCIADOR
        // Se este é o primeiro plano que o usuário ativa E ele foi indicado
        const isFirstPlanEverForUser = user.activeInvestments.length === 1; // Já que acabamos de adicionar

        if (isFirstPlanEverForUser && user.referredBy) {
            const referralRecord = await ReferralHistory.findOne({
                referredId: user._id,
                referrerId: user.referredBy,
                status: 'Pendente' // Só paga comissão se ainda estiver pendente
            });

            if (referralRecord && siteConfig.isReferralCommissionOnRegistrationActive && siteConfig.referralCommissionOnRegistrationPercentage > 0) {
                const referrer = await User.findById(user.referredBy);
                if (referrer && !referrer.isBlocked) {
                    const commissionPercentage = parseFloat(siteConfig.referralCommissionOnRegistrationPercentage);
                    const commissionAmount = parseFloat((investmentAmount * commissionPercentage).toFixed(2));

                    if (commissionAmount > 0) {
                        referrer.balance.MT = (referrer.balance.MT || 0) + commissionAmount;
                        referrer.totalCommissionEarned = (referrer.totalCommissionEarned || 0) + commissionAmount;
                        await referrer.save();

                        referralRecord.status = 'Comissão Paga';
                        referralRecord.commissionEarnedOnRegistration = commissionAmount;
                        referralRecord.registrationCommissionPaidAt = new Date();
                        referralRecord.firstPlanActivatedByReferred = planToActivate._id;
                        referralRecord.firstPlanActivationDate = new Date();
                        await referralRecord.save();

                        console.log(`Comissão de registro de ${commissionAmount} MT paga a ${referrer.email} pela ativação do plano ${planToActivate.name} por ${user.email}.`);
                        // Opcional: Enviar notificação ao referenciador
                        const newNotifToReferrer = new Notification({
                            title: "Comissão de Referência Recebida!",
                            message: `Você recebeu ${commissionAmount.toFixed(2)} MT de comissão pela ativação de plano do seu indicado ${user.name}.`,
                            type: 'success',
                            targetAudience: 'specificUser',
                            targetUserId: referrer._id
                        });
                        await newNotifToReferrer.save();
                    }
                }
            }
        }
        // Fim da lógica de comissão

        await user.save();

        res.status(200).json({ 
            message: `Plano "${planToActivate.name}" ativado com sucesso usando seu saldo! ${expiresAt ? 'Expira em: ' + new Date(expiresAt).toLocaleDateString('pt-BR') : 'Plano vitalício.'}`,
            activatedInvestment: newInvestment, // Retorna o investimento ativado
            newBalanceMT: user.balance.MT
        });

    } catch (error) {
        console.error("Erro ao ativar plano com saldo:", error);
        res.status(500).json({ message: "Erro interno ao tentar ativar o plano. Por favor, tente novamente mais tarde." });
    }
});


app.use('/api/user', userRouter);
// server.js (Continuação - PARTE 5)

// ... (Rotas de Usuário Autenticado da Parte 4) ...

// -----------------------------------------------------------------------------
// 10. ROTAS DO ADMINISTRADOR
// -----------------------------------------------------------------------------
const adminRouter = express.Router();
adminRouter.use(authenticateToken, authorizeAdmin); // Middleware para todas as rotas de admin

// 10.A. Gerenciamento de Categorias de Planos (NOVO)
const planCategoryAdminRouter = express.Router();

// Criar Categoria de Plano
planCategoryAdminRouter.post('/', async (req, res) => {
    const { name, description, slug, order } = req.body;
    if (!name) {
        return res.status(400).json({ message: "Nome da categoria é obrigatório." });
    }
    try {
        let categorySlug = slug;
        if (!slug && name) {
            categorySlug = name.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
        }
        const existingCategory = await PlanCategory.findOne({ $or: [{ name: name }, { slug: categorySlug }] });
        if (existingCategory) {
            return res.status(409).json({ message: "Categoria de plano com este nome ou slug já existe." });
        }
        const newCategory = new PlanCategory({ name, description, slug: categorySlug, order });
        await newCategory.save();
        res.status(201).json(newCategory);
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "Categoria de plano com este nome ou slug já existe (erro de duplicidade)." });
        console.error("Admin - Erro ao criar categoria de plano:", error);
        res.status(500).json({ message: "Erro ao criar categoria de plano.", error: error.message });
    }
});

// Listar Todas as Categorias de Plano (Admin)
planCategoryAdminRouter.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 100, search = '' } = req.query;
        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { slug: { $regex: search, $options: 'i' } }
            ];
        }
        const categories = await PlanCategory.find(query)
            .sort({ order: 1, name: 1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        const totalCategories = await PlanCategory.countDocuments(query);
        res.json({
            categories,
            totalPages: Math.ceil(totalCategories / limit),
            currentPage: parseInt(page),
            totalCount: totalCategories
        });
    } catch (error) {
        console.error("Admin - Erro ao listar categorias de plano:", error);
        res.status(500).json({ message: "Erro ao listar categorias de plano." });
    }
});

// Obter Categoria de Plano por ID
planCategoryAdminRouter.get('/:categoryId', async (req, res) => {
    try {
        const category = await PlanCategory.findById(req.params.categoryId);
        if (!category) return res.status(404).json({ message: "Categoria de plano não encontrada." });
        res.json(category);
    } catch (error) {
        console.error("Admin - Erro ao buscar categoria de plano:", error);
        res.status(500).json({ message: "Erro ao buscar categoria de plano." });
    }
});

// Atualizar Categoria de Plano
planCategoryAdminRouter.put('/:categoryId', async (req, res) => {
    const { name, description, slug, order } = req.body;
    if (!name) return res.status(400).json({ message: "Nome da categoria é obrigatório." });
    try {
        let categorySlug = slug;
        if (!slug && name) {
            categorySlug = name.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
        }
        const existingCategory = await PlanCategory.findOne({
            $or: [{ name: name }, { slug: categorySlug }],
            _id: { $ne: req.params.categoryId }
        });
        if (existingCategory) {
            return res.status(409).json({ message: "Outra categoria de plano com este nome ou slug já existe." });
        }
        const updatedCategory = await PlanCategory.findByIdAndUpdate(
            req.params.categoryId,
            { name, description, slug: categorySlug, order },
            { new: true, runValidators: true }
        );
        if (!updatedCategory) return res.status(404).json({ message: "Categoria de plano não encontrada." });
        res.json(updatedCategory);
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "Outra categoria de plano com este nome ou slug já existe (erro de duplicidade)." });
        console.error("Admin - Erro ao atualizar categoria de plano:", error);
        res.status(500).json({ message: "Erro ao atualizar categoria de plano.", error: error.message });
    }
});

// Deletar Categoria de Plano
planCategoryAdminRouter.delete('/:categoryId', async (req, res) => {
    try {
        // Verificar se a categoria está sendo usada por algum plano
        const plansWithCategory = await Plan.countDocuments({ category: req.params.categoryId });
        if (plansWithCategory > 0) {
            return res.status(400).json({ message: `Não é possível deletar. Categoria está associada a ${plansWithCategory} plano(s). Desassocie os planos primeiro.` });
        }
        const deletedCategory = await PlanCategory.findByIdAndDelete(req.params.categoryId);
        if (!deletedCategory) return res.status(404).json({ message: "Categoria de plano não encontrada." });
        res.json({ message: "Categoria de plano deletada com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar categoria de plano:", error);
        res.status(500).json({ message: "Erro ao deletar categoria de plano." });
    }
});
adminRouter.use('/plan-categories', planCategoryAdminRouter);


// 10.1. Gerenciamento de Depósitos - ATUALIZADO (Considerar comissão de referência)
adminRouter.get('/deposits', async (req, res) => { // Inalterado na listagem
    const { status, userId, page = 1, limit = 10 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = new mongoose.Types.ObjectId(userId);

    try {
        const deposits = await Deposit.find(query)
            .populate('userId', 'name email')
            .sort({ requestedAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        const totalDeposits = await Deposit.countDocuments(query);

        res.json({
            deposits,
            totalPages: Math.ceil(totalDeposits / limit),
            currentPage: parseInt(page),
            totalCount: totalDeposits
        });
    } catch (error) {
        console.error("Admin - Erro ao listar depósitos:", error);
        res.status(500).json({ message: "Erro ao listar depósitos." });
    }
});

adminRouter.patch('/deposits/:depositId/confirm', async (req, res) => { // Rota específica para confirmação
    const { depositId } = req.params;
    const { adminNotes } = req.body; // targetPlanId removido daqui, a ativação é feita pelo usuário

    try {
        const deposit = await Deposit.findById(depositId);
        if (!deposit) {
            return res.status(404).json({ message: "Depósito não encontrado." });
        }
        if (deposit.status !== 'Pendente') {
            return res.status(400).json({ message: `Este depósito já foi ${deposit.status.toLowerCase()}.` });
        }

        const user = await User.findById(deposit.userId);
        if (!user) {
            return res.status(404).json({ message: "Usuário associado ao depósito não encontrado." });
        }

        deposit.status = 'Confirmado';
        deposit.processedAt = new Date();
        if (adminNotes) deposit.adminNotes = adminNotes;

        user.balance.MT = (user.balance.MT || 0) + deposit.amount;

        const wasFirstDeposit = !user.firstDepositMade;
        if (wasFirstDeposit) {
            user.firstDepositMade = true;
        }
        
        // A lógica de comissão de referência por registro agora é acionada quando o usuário indicado
        // ATIVA SEU PRIMEIRO PLANO (seja com saldo de depósito ou bônus).
        // Se a ativação do plano for manual pelo admin APÓS um depósito, essa lógica
        // precisaria ser invocada separadamente ou na rota de "atribuir plano ao usuário" do admin.
        // Por agora, a rota `/api/user/activate-plan-with-balance` já cuida da comissão de registro.
        // A confirmação do depósito apenas libera o saldo.

        await user.save();
        await deposit.save();
        res.json({ message: `Depósito confirmado com sucesso. Saldo do usuário atualizado.`, deposit });

    } catch (error) {
        console.error(`Admin - Erro ao confirmar depósito:`, error);
        res.status(500).json({ message: "Erro ao processar o depósito." });
    }
});

adminRouter.patch('/deposits/:depositId/reject', async (req, res) => { // Rota específica para rejeição
    const { depositId } = req.params;
    const { adminNotes } = req.body;

    if (!adminNotes) {
        return res.status(400).json({ message: "Notas do administrador são obrigatórias para rejeitar um depósito." });
    }

    try {
        const deposit = await Deposit.findById(depositId);
        if (!deposit) {
            return res.status(404).json({ message: "Depósito não encontrado." });
        }
        if (deposit.status !== 'Pendente') {
            return res.status(400).json({ message: `Este depósito já foi ${deposit.status.toLowerCase()}.` });
        }

        deposit.status = 'Rejeitado';
        deposit.processedAt = new Date();
        deposit.adminNotes = adminNotes;

        await deposit.save();
        res.json({ message: `Depósito rejeitado com sucesso.`, deposit });

    } catch (error) {
        console.error(`Admin - Erro ao rejeitar depósito:`, error);
        res.status(500).json({ message: "Erro ao processar o depósito." });
    }
});


// 10.2. Gerenciamento de Métodos de Pagamento (Inalterado)
adminRouter.get('/payment-methods', async (req, res) => {
    try {
        const setting = await AdminSetting.findOne({ key: 'paymentMethods' });
        const methods = setting && setting.value ? setting.value : [];
        res.json(methods);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar métodos de pagamento.', error: error.message });
    }
});
adminRouter.post('/payment-methods', async (req, res) => {
    const { methods } = req.body; // Espera um array de objetos de método
    if (!Array.isArray(methods)) {
        return res.status(400).json({ message: 'Formato inválido. "methods" deve ser um array.' });
    }
    for (const method of methods) {
        if (!method.name || !method.details || !method.type) {
            return res.status(400).json({ message: 'Cada método deve ter nome, detalhes e tipo (fiat/crypto).' });
        }
         if (!['fiat', 'crypto'].includes(method.type)) {
            return res.status(400).json({ message: `Tipo de método inválido: ${method.type}. Use 'fiat' ou 'crypto'.`});
        }
    }
    try {
        await AdminSetting.findOneAndUpdate(
            { key: 'paymentMethods' },
            { key: 'paymentMethods', value: methods, description: 'Lista de métodos de pagamento para depósito.' },
            { upsert: true, new: true, runValidators: true }
        );
        siteSettingsCache = null; // Invalida o cache
        await getSiteSettings();
        res.json({ message: 'Métodos de pagamento atualizados com sucesso.', methods });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar métodos de pagamento.', error: error.message });
    }
});

// 10.3. Gerenciamento de Planos de Investimento - ATUALIZADO
// Listar Planos (Admin)
adminRouter.get('/plans', async (req, res) => {
    try {
        const plans = await Plan.find({})
            .populate('category', 'name slug')
            .sort({ 'category.order': 1, order: 1, investmentAmount: 1 });
        res.json(plans);
    } catch (error) {
        console.error("Admin - Erro ao buscar planos:", error);
        res.status(500).json({ message: "Erro ao buscar planos." });
    }
});

// Criar Plano (Admin) - ATUALIZADO para upload e novos campos
// A rota usará upload.single('planImageFile') se uma imagem for enviada
adminRouter.post(
    '/plans',
    setUploadPath('plan-images'), // Define subpasta para imagens de planos
    upload.single('planImageFile'), // 'planImageFile' deve ser o nome do campo no form-data
    async (req, res) => {
        const {
            name, investmentAmount, dailyProfitRate, dailyProfitAmount, claimValue,
            claimsPerDay = 5, isActive = true, order = 0, description, tags,
            durationValue, durationType, category, // Novos campos
            imageUrl // URL externa, se não houver arquivo
        } = req.body;

        if (!name || !investmentAmount || !dailyProfitRate || !dailyProfitAmount || !claimValue) {
            return res.status(400).json({ message: "Campos obrigatórios do plano não preenchidos." });
        }
        if (durationType && !['days', 'weeks', 'lifelong'].includes(durationType)) {
            return res.status(400).json({ message: "Tipo de duração inválido." });
        }
        if (durationType !== 'lifelong' && (isNaN(parseInt(durationValue)) || parseInt(durationValue) <= 0)) {
            return res.status(400).json({ message: "Valor de duração inválido para o tipo especificado." });
        }


        let finalImageUrl = imageUrl || ''; // URL externa ou vazia
        if (req.file) {
            // Salva o path relativo ao servidor. O frontend adicionará a base URL.
            finalImageUrl = `/uploads/plan-images/${req.file.filename}`;
        }

        try {
            const parsedDurationValue = durationType === 'lifelong' ? null : parseInt(durationValue);

            const newPlan = new Plan({
                name, investmentAmount: parseFloat(investmentAmount),
                dailyProfitRate: parseFloat(dailyProfitRate),
                dailyProfitAmount: parseFloat(dailyProfitAmount),
                claimValue: parseFloat(claimValue),
                claimsPerDay: parseInt(claimsPerDay), isActive, order: parseInt(order),
                description, tags: tags ? JSON.parse(tags) : [], // Tags podem vir como string JSON de form-data
                imageUrl: finalImageUrl,
                durationValue: parsedDurationValue,
                durationType,
                category: category || null, // ID da categoria
            });
            await newPlan.save();
            res.status(201).json({ message: "Plano criado com sucesso.", plan: newPlan });
        } catch (error) {
            if (req.file && finalImageUrl) { // Se o save falhar e um arquivo foi salvo, remover o arquivo.
                fs.unlink(path.join(__dirname, finalImageUrl), err => {
                    if (err) console.error("Admin - Erro ao remover arquivo de plano após falha na criação:", err);
                });
            }
            if (error.code === 11000) {
                return res.status(409).json({ message: "Erro: Já existe um plano com este nome ou valor de investimento.", details: error.keyValue });
            }
            console.error("Admin - Erro ao criar plano:", error);
            res.status(500).json({ message: "Erro ao criar plano.", errorDetails: error.message });
        }
    }
);

// Atualizar Plano (Admin) - ATUALIZADO para upload e novos campos
adminRouter.put(
    '/plans/:planId',
    setUploadPath('plan-images'),
    upload.single('planImageFile'),
    async (req, res) => {
        const { planId } = req.params;
        const {
            name, investmentAmount, dailyProfitRate, dailyProfitAmount, claimValue,
            claimsPerDay, isActive, order, description, tags,
            durationValue, durationType, category,
            imageUrl, removeCurrentImage // URL externa ou flag para remover imagem
        } = req.body;

        if (durationType && !['days', 'weeks', 'lifelong'].includes(durationType)) {
            return res.status(400).json({ message: "Tipo de duração inválido." });
        }
         if (durationType !== 'lifelong' && durationValue && (isNaN(parseInt(durationValue)) || parseInt(durationValue) <= 0)) {
            return res.status(400).json({ message: "Valor de duração inválido para o tipo especificado." });
        }

        try {
            const plan = await Plan.findById(planId);
            if (!plan) {
                if (req.file) { // Se o plano não existe e um arquivo foi enviado
                     fs.unlink(path.join(UPLOADS_DIR, 'plan-images', req.file.filename), err => {
                        if (err) console.error("Admin - Erro ao remover arquivo de plano para plano inexistente:", err);
                    });
                }
                return res.status(404).json({ message: "Plano não encontrado." });
            }

            const updateData = { ...req.body };
            delete updateData.planImageFile; // Não salvar o nome do campo do arquivo
            
            if (tags) updateData.tags = Array.isArray(tags) ? tags : JSON.parse(tags);


            if (req.file) { // Nova imagem enviada
                if (plan.imageUrl && plan.imageUrl.startsWith('/uploads/')) { // Se havia imagem local antiga
                    fs.unlink(path.join(__dirname, plan.imageUrl), err => { // __dirname para path absoluto
                        if (err) console.warn("Admin - Erro ao remover imagem antiga do plano:", err.message);
                    });
                }
                updateData.imageUrl = `/uploads/plan-images/${req.file.filename}`;
            } else if (removeCurrentImage === 'true' && plan.imageUrl) {
                 if (plan.imageUrl.startsWith('/uploads/')) {
                    fs.unlink(path.join(__dirname, plan.imageUrl), err => {
                        if (err) console.warn("Admin - Erro ao remover imagem atual do plano:", err.message);
                    });
                }
                updateData.imageUrl = ''; // Remove a imagem
            } else if (imageUrl) { // Se uma URL externa for fornecida e não houver novo arquivo
                updateData.imageUrl = imageUrl;
            }
            // Se nem req.file, nem removeCurrentImage, nem imageUrl for enviado, a imagem atual é mantida.

            if (durationType) {
                updateData.durationType = durationType;
                updateData.durationValue = durationType === 'lifelong' ? null : parseInt(durationValue);
            } else if (durationValue) { // Se só durationValue for enviado e não durationType
                updateData.durationValue = parseInt(durationValue);
            }


            if (investmentAmount) updateData.investmentAmount = parseFloat(investmentAmount);
            if (dailyProfitRate) updateData.dailyProfitRate = parseFloat(dailyProfitRate);
            if (dailyProfitAmount) updateData.dailyProfitAmount = parseFloat(dailyProfitAmount);
            if (claimValue) updateData.claimValue = parseFloat(claimValue);
            if (claimsPerDay) updateData.claimsPerDay = parseInt(claimsPerDay);
            if (order) updateData.order = parseInt(order);
            if (category === '' || category === 'null') updateData.category = null; // Para desassociar categoria

            const updatedPlan = await Plan.findByIdAndUpdate(planId, updateData, { new: true, runValidators: true })
                                        .populate('category', 'name slug');

            res.json({ message: "Plano atualizado com sucesso.", plan: updatedPlan });
        } catch (error) {
             if (req.file) { // Se o update falhar e um novo arquivo foi salvo, remover o NOVO arquivo.
                fs.unlink(path.join(UPLOADS_DIR, 'plan-images', req.file.filename), err => {
                    if (err) console.error("Admin - Erro ao remover arquivo de plano após falha na atualização:", err);
                });
            }
            if (error.code === 11000) {
                return res.status(409).json({ message: "Erro: Já existe outro plano com este nome ou valor de investimento.", details: error.keyValue });
            }
            console.error("Admin - Erro ao atualizar plano:", error);
            res.status(500).json({ message: "Erro ao atualizar plano.", errorDetails: error.message });
        }
    }
);

// Deletar Plano (Admin)
adminRouter.delete('/plans/:planId', async (req, res) => {
    const { planId } = req.params;
    try {
        // Verificar se o plano está ativo para algum usuário
        const usersWithPlan = await User.countDocuments({ "activeInvestments.planId": planId });
        if (usersWithPlan > 0) {
            return res.status(400).json({ message: `Não é possível deletar o plano. Ele está ativo para ${usersWithPlan} usuário(s). Considere desativá-lo primeiro.` });
        }
        const plan = await Plan.findByIdAndDelete(planId);
        if (!plan) return res.status(404).json({ message: "Plano não encontrado." });

        // Se o plano tinha uma imagem local, deletá-la
        if (plan.imageUrl && plan.imageUrl.startsWith('/uploads/')) {
            fs.unlink(path.join(__dirname, plan.imageUrl), err => {
                if (err) console.warn("Admin - Erro ao remover imagem do plano deletado:", err.message);
            });
        }
        res.json({ message: "Plano deletado com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar plano:", error);
        res.status(500).json({ message: "Erro ao deletar plano." });
    }
});


// 10.4. Gerenciamento de Usuários - (Mais abaixo, após outras seções)

// 10.5. Gerenciamento de Saques - (Mais abaixo)

// 10.6. Gerenciamento de Configurações Gerais do Site - ATUALIZADO
adminRouter.get('/settings', async (req, res) => {
    try {
        const settingsFromDB = await AdminSetting.find({});
        const formattedSettings = {};
        settingsFromDB.forEach(s => formattedSettings[s.key] = { value: s.value, description: s.description });
        
        // Adicionar descrições para chaves que podem não estar no DB mas têm defaults no código, se necessário
        // Ou garantir que initializeDefaultSettings sempre adicione todas as chaves com descrições.

        res.json(formattedSettings);
    } catch (error) {
        console.error("Admin - Erro ao buscar configurações:", error);
        res.status(500).json({ message: 'Erro ao buscar configurações.', error: error.message });
    }
});

adminRouter.post('/settings', async (req, res) => {
    const updates = req.body; // Espera um objeto com { chave: valor, chave2: valor2 }
    if (typeof updates !== 'object' || updates === null) {
        return res.status(400).json({ message: 'Corpo da requisição deve ser um objeto de configurações.' });
    }

    try {
        const results = [];
        const allSettings = await getSiteSettings(); // Pega as configurações atuais para validar tipos, se necessário

        for (const key in updates) {
            if (Object.hasOwnProperty.call(updates, key)) {
                const value = updates[key];
                // Validações específicas por chave podem ser adicionadas aqui
                // Ex: para 'referralCommissionOnRegistrationPercentage', garantir que seja um número entre 0 e 1.
                let processedValue = value;
                if (key === 'referralCommissionOnRegistrationPercentage' || key === 'referralCommissionOnClaimsPercentage') {
                    processedValue = parseFloat(value);
                    if (isNaN(processedValue) || processedValue < 0 || processedValue > 1) {
                        return res.status(400).json({ message: `Valor para ${key} deve ser um número entre 0 e 1.` });
                    }
                }
                if (key === 'registrationBonusAmount' || key === 'minWithdrawalAmount' || key === 'maxWithdrawalAmount') {
                    processedValue = parseFloat(value);
                     if (isNaN(processedValue) || processedValue < 0) {
                        return res.status(400).json({ message: `Valor para ${key} deve ser um número não negativo.` });
                    }
                }
                // Para booleanos
                if (key === 'isRegistrationBonusActive' || key === 'isReferralCommissionOnRegistrationActive' || key === 'isReferralCommissionOnClaimsActive') {
                    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
                         return res.status(400).json({ message: `Valor para ${key} deve ser um booleano (true/false).`});
                    }
                    processedValue = (value === 'true' || value === true);
                }


                const setting = await AdminSetting.findOneAndUpdate(
                    { key },
                    { $set: { value: processedValue } }, // Usar $set para apenas atualizar o valor
                    { new: true, upsert: false } // Não criar se não existir (deve ser criado por initializeDefaultSettings)
                );
                if (setting) {
                    results.push(setting);
                } else {
                    console.warn(`Admin - Tentativa de atualizar configuração não existente via API: ${key}`);
                    // Poderia optar por criar aqui também se essa for a política desejada:
                    // const newSetting = await AdminSetting.create({ key, value: processedValue, description: "Atualizado via API" });
                    // results.push(newSetting);
                }
            }
        }
        siteSettingsCache = null; // Invalida o cache para forçar releitura
        await getSiteSettings();
        res.json({ message: `${results.length} configuração(ões) atualizada(s) com sucesso.`, updatedSettings: results });
    } catch (error) {
        console.error("Admin - Erro ao atualizar configurações:", error);
        res.status(500).json({ message: 'Erro ao atualizar configurações.', error: error.message });
    }
});
// server.js (Continuação - PARTE 5)

// ... (Início das Rotas de Admin da Parte 5 anterior, incluindo PlanCategories, Deposits, PaymentMethods, Plans, Settings) ...

// 10.4. Gerenciamento de Usuários - ATUALIZADO
adminRouter.get('/users', async (req, res) => {
    const { page = 1, limit = 10, search = '', isBlocked, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const query = {};

    if (search) {
        const searchRegex = { $regex: search, $options: 'i' };
        query.$or = [
            { name: searchRegex },
            { email: searchRegex },
            { referralCode: searchRegex }
        ];
    }
    if (typeof isBlocked !== 'undefined' && (isBlocked === 'true' || isBlocked === 'false')) {
        query.isBlocked = isBlocked === 'true';
    }

    try {
        const users = await User.find(query)
            .select('-password -securityAnswer -resetPasswordToken -resetPasswordExpires') // securityQuestion pode ser útil para admin
            .populate('referredBy', 'name email')
            .populate({
                path: 'activeInvestments.planId', // Popula o plano dentro de activeInvestments
                select: 'name investmentAmount durationType durationValue'
            })
            .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        const totalUsers = await User.countDocuments(query);
        res.json({
            users: users.map(u => { // Formata a saída se necessário
                const userObject = u.toObject();
                userObject.activeInvestmentsCount = userObject.activeInvestments ? userObject.activeInvestments.length : 0;
                return userObject;
            }),
            totalPages: Math.ceil(totalUsers / limit),
            currentPage: parseInt(page),
            totalCount: totalUsers
        });
    } catch (error) {
        console.error("Admin - Erro ao listar usuários:", error);
        res.status(500).json({ message: "Erro ao listar usuários." });
    }
});

adminRouter.get('/users/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .select('-password -securityAnswer -resetPasswordToken -resetPasswordExpires')
            .populate({
                path: 'activeInvestments.planId',
                select: 'name investmentAmount durationType durationValue category',
                populate: { path: 'category', select: 'name slug'}
            })
            .populate({ path: 'referredBy', select: 'name email' })
            .populate({
                path: 'claimHistory', // Popula o histórico de claims
                options: { sort: { claimedAt: -1 }, limit: 20 } // Limita os claims recentes
            });

        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const deposits = await Deposit.find({ userId: user._id }).sort({ requestedAt: -1 }).limit(10);
        const withdrawals = await Withdrawal.find({ userId: user._id }).sort({ requestedAt: -1 }).limit(10);
        
        // Histórico de referências onde este usuário FOI O INDICADOR
        const referralsMade = await ReferralHistory.find({ referrerId: user._id })
            .populate('referredId', 'name email createdAt')
            .populate('firstPlanActivatedByReferred', 'name investmentAmount')
            .sort({ createdAt: -1 });

        // Histórico de referência onde este usuário FOI O INDICADO
        const referredByRecord = user.referredBy ? await ReferralHistory.findOne({ referredId: user._id })
            .populate('referrerId', 'name email')
            .populate('firstPlanActivatedByReferred', 'name investmentAmount') : null;

        // Logs de comissão de claim para este usuário (como referenciador)
        const claimCommissionLogs = await DailyClaimCommissionLog.find({ referrerId: user._id})
            .populate('referredId', 'name email')
            .sort({date: -1})
            .limit(20);


        res.json({
            user,
            deposits,
            withdrawals,
            referralsMade, // Quem ele indicou
            referredByRecord, // Por quem ele foi indicado e o status dessa comissão
            claimCommissionLogs // Comissões de claims que ele recebeu
        });
    } catch (error) {
        console.error("Admin - Erro ao buscar detalhes do usuário:", error);
        res.status(500).json({ message: "Erro ao buscar detalhes do usuário." });
    }
});

adminRouter.patch('/users/:userId/block', async (req, res) => { // Inalterado
    const { block } = req.body; // Espera { block: true/false }
    if (typeof block !== 'boolean') {
        return res.status(400).json({ message: "O status de bloqueio (block) deve ser true ou false." });
    }
    try {
        const user = await User.findByIdAndUpdate(req.params.userId, { isBlocked: block }, { new: true })
            .select('name email isBlocked');
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });
        res.json({ message: `Usuário ${user.name} ${block ? 'bloqueado' : 'desbloqueado'} com sucesso.`, user });
    } catch (error) {
        console.error("Admin - Erro ao bloquear/desbloquear usuário:", error);
        res.status(500).json({ message: "Erro ao atualizar status de bloqueio do usuário." });
    }
});

// Atribuir plano manualmente (Admin) - ATUALIZADO para usar duração e expiração
adminRouter.post('/users/:userId/assign-plan', async (req, res) => {
    const { userId } = req.params;
    const { planId } = req.body; // ID do modelo Plan

    if (!planId) {
        return res.status(400).json({ message: "ID do plano (planId) é obrigatório." });
    }

    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." });

        const planToAssign = await Plan.findById(planId);
        if (!planToAssign || !planToAssign.isActive) {
            return res.status(404).json({ message: "Plano não encontrado ou está inativo." });
        }

        // Calcular data de expiração
        let expiresAt = null;
        if (planToAssign.durationType !== 'lifelong' && planToAssign.durationValue && planToAssign.durationValue > 0) {
            expiresAt = new Date();
            if (planToAssign.durationType === 'days') {
                expiresAt.setDate(expiresAt.getDate() + planToAssign.durationValue);
            } else if (planToAssign.durationType === 'weeks') {
                expiresAt.setDate(expiresAt.getDate() + (planToAssign.durationValue * 7));
            }
            expiresAt.setHours(23, 59, 59, 999);
        }

        const newInvestment = {
            planId: planToAssign._id,
            planName: planToAssign.name,
            investedAmount: planToAssign.investmentAmount, // O admin está atribuindo, o valor não é deduzido do saldo do usuário aqui
            dailyProfitRate: planToAssign.dailyProfitRate,
            dailyProfitAmount: planToAssign.dailyProfitAmount,
            claimValue: planToAssign.claimValue,
            claimsMadeToday: 0,
            activatedAt: new Date(),
            expiresAt: expiresAt,
        };
        user.activeInvestments.push(newInvestment);
        
        // Se esta atribuição manual pelo admin contar como a "primeira ativação" para fins de comissão de referência
        // a lógica de comissão precisaria ser invocada aqui também.
        // Por simplicidade, vamos assumir que a comissão de registro é primariamente via /api/user/activate-plan-with-balance
        // ou via confirmação de depósito se isso for implementado para acionar a comissão.
        // Se o admin atribui um plano e isso deve gerar comissão, a lógica de comissão deve ser replicada/chamada aqui.
        // Por ora, esta rota apenas atribui o plano.

        await user.save();
        res.json({ message: `Plano ${planToAssign.name} atribuído com sucesso ao usuário ${user.name}.`, investment: newInvestment });

    } catch (error) {
        console.error("Admin - Erro ao atribuir plano:", error);
        res.status(500).json({ message: "Erro ao atribuir plano ao usuário." });
    }
});

// Rota para verificar resposta de segurança e gerar link de reset (Admin) - Inalterada
adminRouter.post('/users/:userId/verify-security-answer', async (req, res) => {
    const { userId } = req.params;
    const { answer } = req.body;

    if (!answer) {
        return res.status(400).json({ message: "Resposta de segurança é obrigatória." });
    }
    try {
        const user = await User.findById(userId).select('+securityAnswer +securityQuestion');
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }
        if (!user.securityAnswer || !user.securityQuestion) {
            return res.status(400).json({ message: "Usuário não configurou pergunta/resposta de segurança." });
        }
        const isMatch = await bcrypt.compare(answer, user.securityAnswer);
        if (!isMatch) {
            return res.status(400).json({ message: "Resposta de segurança incorreta." });
        }
        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hora
        await user.save();
        const resetUrl = `${FRONTEND_URL}/reset-password.html?token=${resetToken}`;
        res.json({
            message: "Resposta de segurança verificada. Envie o link para o usuário redefinir a senha:",
            resetUrl: resetUrl,
            securityQuestion: user.securityQuestion
        });
    } catch (error) {
        console.error("Admin - Erro ao verificar resposta de segurança:", error);
        res.status(500).json({ message: "Erro ao verificar resposta de segurança e gerar link." });
    }
});

// Ajustar saldo do usuário (Admin) - ATUALIZADO (sem referralEarnings)
adminRouter.patch('/users/:userId/adjust-balance', async (req, res) => {
    const { userId } = req.params;
    const { amount, balanceType, reason, operation = 'add' } = req.body; // MT, bonusBalance

    if (!amount || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ message: "Valor (amount) inválido ou não fornecido." });
    }
    if (!balanceType || !['MT', 'bonusBalance', 'totalCommissionEarned'].includes(balanceType)) {
        return res.status(400).json({ message: "Tipo de saldo (balanceType) inválido. Use 'MT', 'bonusBalance' ou 'totalCommissionEarned'." });
    }
    if (!reason || reason.trim() === '') {
        return res.status(400).json({ message: "Motivo (reason) é obrigatório para o ajuste." });
    }
    if (!['add', 'subtract'].includes(operation)) {
        return res.status(400).json({ message: "Operação (operation) inválida. Use 'add' ou 'subtract'."});
    }

    try {
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." });
        }

        let originalValue;
        let fieldToUpdate = '';

        if (balanceType === 'MT') {
            originalValue = user.balance.MT || 0;
            fieldToUpdate = 'balance.MT';
        } else if (balanceType === 'bonusBalance') {
            originalValue = user.bonusBalance || 0;
            fieldToUpdate = 'bonusBalance';
        } else if (balanceType === 'totalCommissionEarned') { // Geralmente não se ajusta manualmente, mas incluído
            originalValue = user.totalCommissionEarned || 0;
            fieldToUpdate = 'totalCommissionEarned';
        }

        let newValue;
        if (operation === 'subtract') {
            if (originalValue < amount) return res.status(400).json({ message: `Saldo em ${balanceType} insuficiente (${originalValue.toFixed(2)}) para remover ${amount.toFixed(2)}.` });
            newValue = originalValue - amount;
        } else {
            newValue = originalValue + amount;
        }

        if (balanceType === 'MT') user.balance.MT = newValue;
        else if (balanceType === 'bonusBalance') user.bonusBalance = newValue;
        else if (balanceType === 'totalCommissionEarned') user.totalCommissionEarned = newValue;
        
        await user.save();
        console.log(`Admin ${req.user.id} ajustou ${balanceType} do usuário ${userId}. Operação: ${operation}, Valor: ${amount}, Razão: ${reason}. Novo valor: ${newValue.toFixed(2)}`);

        res.json({
            message: `Saldo ${balanceType} do usuário ${user.name} ${operation === 'subtract' ? 'reduzido' : 'aumentado'} em ${amount.toFixed(2)} MT. Motivo: ${reason}`,
            user: {
                _id: user._id, name: user.name, balance: user.balance,
                bonusBalance: user.bonusBalance, totalCommissionEarned: user.totalCommissionEarned
            }
        });
    } catch (error) {
        console.error("Admin - Erro ao ajustar saldo do usuário:", error);
        res.status(500).json({ message: "Erro interno ao ajustar saldo." });
    }
});


// 10.5. Gerenciamento de Saques - ATUALIZADO (devolução ao saldo MT)
adminRouter.get('/withdrawals', async (req, res) => { // Inalterado na listagem
    const { status, userId, page = 1, limit = 10 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (userId) query.userId = new mongoose.Types.ObjectId(userId);

    try {
        const withdrawals = await Withdrawal.find(query)
            .populate('userId', 'name email')
            .sort({ requestedAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));
        const totalWithdrawals = await Withdrawal.countDocuments(query);
        res.json({
            withdrawals,
            totalPages: Math.ceil(totalWithdrawals / limit),
            currentPage: parseInt(page),
            totalCount: totalWithdrawals
        });
    } catch (error) {
        console.error("Admin - Erro ao listar saques:", error);
        res.status(500).json({ message: "Erro ao listar saques." });
    }
});

adminRouter.patch('/withdrawals/:withdrawalId/process', async (req, res) => { // Rota específica
    const { withdrawalId } = req.params;
    const { adminNotes } = req.body;
    try {
        const withdrawal = await Withdrawal.findById(withdrawalId);
        if (!withdrawal) return res.status(404).json({ message: "Solicitação de saque não encontrada." });
        if (withdrawal.status !== 'Pendente') return res.status(400).json({ message: `Este saque já foi ${withdrawal.status.toLowerCase()}.` });

        withdrawal.status = 'Processado';
        withdrawal.processedAt = new Date();
        if (adminNotes) withdrawal.adminNotes = adminNotes;
        // Nenhuma alteração de saldo aqui, pois o saldo já foi deduzido na solicitação do usuário.
        await withdrawal.save();
        res.json({ message: `Saque processado com sucesso.`, withdrawal });
    } catch (error) {
        console.error(`Admin - Erro ao processar saque:`, error);
        res.status(500).json({ message: "Erro ao processar o saque." });
    }
});

adminRouter.patch('/withdrawals/:withdrawalId/reject', async (req, res) => { // Rota específica
    const { withdrawalId } = req.params;
    const { adminNotes } = req.body;
    if (!adminNotes) return res.status(400).json({ message: "Notas do administrador são obrigatórias para rejeitar." });
    try {
        const withdrawal = await Withdrawal.findById(withdrawalId);
        if (!withdrawal) return res.status(404).json({ message: "Solicitação de saque não encontrada." });
        if (withdrawal.status !== 'Pendente') return res.status(400).json({ message: `Este saque já foi ${withdrawal.status.toLowerCase()}.` });

        const user = await User.findById(withdrawal.userId);
        if (!user) { // Improvável, mas checar
            withdrawal.status = 'Rejeitado'; // Rejeita mesmo sem usuário para evitar loop
            withdrawal.processedAt = new Date();
            if (adminNotes) withdrawal.adminNotes = adminNotes;
            await withdrawal.save();
            console.error(`Admin: Usuário ${withdrawal.userId} do saque ${withdrawalId} rejeitado não encontrado para devolução de saldo.`);
            return res.status(200).json({ message: "Saque rejeitado. Usuário não encontrado para devolução de saldo.", withdrawal });
        }

        // Devolve o valor TOTAL SOLICITADO (withdrawal.amount) ao saldo principal do usuário
        // A taxa foi calculada mas o valor líquido não foi enviado. O usuário solicitou X, então X é devolvido.
        user.balance.MT = (user.balance.MT || 0) + withdrawal.amount;
        await user.save();

        withdrawal.status = 'Rejeitado';
        withdrawal.processedAt = new Date();
        if (adminNotes) withdrawal.adminNotes = adminNotes;
        await withdrawal.save();
        
        console.log(`Admin: Saque ${withdrawalId} rejeitado. Valor ${withdrawal.amount} MT devolvido ao saldo MT do usuário ${user.email}.`);
        res.json({ message: `Saque rejeitado com sucesso. Saldo devolvido ao usuário.`, withdrawal });
    } catch (error) {
        console.error(`Admin - Erro ao rejeitar saque:`, error);
        res.status(500).json({ message: "Erro ao processar o saque." });
    }
});


// 10.7. Gerenciamento de Notificações/Comunicados (Admin) - Inalterado funcionalmente
adminRouter.post('/notifications', async (req, res) => {
    const { title, message, type, targetAudience = 'all', targetUserId, expiresAt, link, isActive = true } = req.body;
    if (!title || !message || !type) {
        return res.status(400).json({ message: "Título, mensagem e tipo são obrigatórios." });
    }
    if (targetAudience === 'specificUser' && !mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res.status(400).json({ message: "targetUserId é obrigatório e deve ser um ID válido para targetAudience 'specificUser'." });
    }
    try {
        const notification = new Notification({
            title, message, type, targetAudience,
            targetUserId: targetAudience === 'specificUser' ? targetUserId : null,
            isActive, expiresAt, link
        });
        await notification.save();
        res.status(201).json({ message: "Notificação criada com sucesso.", notification });
    } catch (error) {
        console.error("Admin - Erro ao criar notificação:", error);
        res.status(500).json({ message: "Erro ao criar notificação." });
    }
});

adminRouter.get('/notifications', async (req, res) => {
    try {
        const { page = 1, limit = 10, type, targetAudience, isActive } = req.query;
        const query = {};
        if (type) query.type = type;
        if (targetAudience) query.targetAudience = targetAudience;
        if (typeof isActive !== 'undefined') query.isActive = isActive === 'true';

        const notifications = await Notification.find(query)
            .populate('targetUserId', 'name email')
            .sort({ createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));
        const totalNotifications = await Notification.countDocuments(query);
        res.json({
            notifications,
            totalPages: Math.ceil(totalNotifications / limit),
            currentPage: parseInt(page),
            totalCount: totalNotifications
        });
    } catch (error) {
        console.error("Admin - Erro ao listar notificações:", error);
        res.status(500).json({ message: "Erro ao listar notificações." });
    }
});

adminRouter.put('/notifications/:notificationId', async (req, res) => {
    const { notificationId } = req.params;
    const { title, message, type, targetAudience, targetUserId, isActive, expiresAt, link } = req.body;
    if (targetAudience === 'specificUser' && (targetUserId && !mongoose.Types.ObjectId.isValid(targetUserId))) {
        return res.status(400).json({ message: "targetUserId deve ser um ID válido para targetAudience 'specificUser' se fornecido." });
    }
    try {
        const updateData = { title, message, type, targetAudience, isActive, expiresAt, link };
        updateData.targetUserId = (targetAudience === 'specificUser' && targetUserId) ? targetUserId : null;

        const notification = await Notification.findByIdAndUpdate(notificationId, updateData, { new: true, runValidators: true });
        if (!notification) return res.status(404).json({ message: "Notificação não encontrada." });
        res.json({ message: "Notificação atualizada com sucesso.", notification });
    } catch (error) {
        console.error("Admin - Erro ao atualizar notificação:", error);
        res.status(500).json({ message: "Erro ao atualizar notificação." });
    }
});

adminRouter.delete('/notifications/:notificationId', async (req, res) => { // Inalterado
    try {
        const notification = await Notification.findByIdAndDelete(req.params.notificationId);
        if (!notification) return res.status(404).json({ message: "Notificação não encontrada." });
        // Deleta os status associados para limpeza
        await UserNotificationStatus.deleteMany({ notificationId: req.params.notificationId });
        res.json({ message: "Notificação deletada com sucesso (e status de usuário associados)." });
    } catch (error) {
        console.error("Admin - Erro ao deletar notificação:", error);
        res.status(500).json({ message: "Erro ao deletar notificação." });
    }
});
// server.js (Continuação - PARTE 5 Final)

// ... (Rotas de Admin das seções anteriores da Parte 5) ...

// 10.8. Estatísticas Gerais - ATUALIZADO
adminRouter.get('/stats/overview', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ lastLoginAt: { $gte: new Date(new Date() - 30 * 24 * 60 * 60 * 1000) } }); // Últimos 30 dias

        const depositAggregation = await Deposit.aggregate([
            { $match: { status: 'Confirmado' } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);
        const totalDeposited = depositAggregation.length > 0 ? depositAggregation[0].total : 0;
        const totalDepositsConfirmed = depositAggregation.length > 0 ? depositAggregation[0].count : 0;

        const withdrawalAggregation = await Withdrawal.aggregate([
            { $match: { status: 'Processado' } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);
        const totalWithdrawn = withdrawalAggregation.length > 0 ? withdrawalAggregation[0].total : 0;
        const totalWithdrawalsProcessed = withdrawalAggregation.length > 0 ? withdrawalAggregation[0].count : 0;

        const pendingDepositsCount = await Deposit.countDocuments({ status: 'Pendente' });
        const pendingWithdrawalsCount = await Withdrawal.countDocuments({ status: 'Pendente' });

        const plans = await Plan.find({ isActive: true }).select('name _id');
        const activeInvestmentsByPlan = {};
        let totalActiveInvestments = 0;
        for (const plan of plans) {
            const count = await User.countDocuments({ 'activeInvestments.planId': plan._id, 'activeInvestments.expiresAt': { $or: [null, { $gt: new Date() }] } });
            activeInvestmentsByPlan[plan.name] = count;
            totalActiveInvestments += count;
        }

        // Novas estatísticas de comissão
        const totalCommissionOnRegistration = await ReferralHistory.aggregate([
            { $match: { status: 'Comissão Paga', commissionEarnedOnRegistration: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: '$commissionEarnedOnRegistration' } } }
        ]);
        const totalRegCommissionPaid = totalCommissionOnRegistration.length > 0 ? totalCommissionOnRegistration[0].total : 0;

        const totalCommissionOnClaims = await DailyClaimCommissionLog.aggregate([
            { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
        ]);
        const totalClaimCommissionPaid = totalCommissionOnClaims.length > 0 ? totalCommissionOnClaims[0].total : 0;
        
        const totalOverallCommissionPaid = totalRegCommissionPaid + totalClaimCommissionPaid;

        res.json({
            totalUsers,
            activeUsers,
            totalDeposited,
            totalDepositsConfirmed,
            totalWithdrawn,
            totalWithdrawalsProcessed,
            pendingDepositsCount,
            pendingWithdrawalsCount,
            activeInvestmentsByPlan,
            totalActiveInvestments,
            totalCommissionPaid: {
                registration: parseFloat(totalRegCommissionPaid.toFixed(2)),
                claims: parseFloat(totalClaimCommissionPaid.toFixed(2)),
                overall: parseFloat(totalOverallCommissionPaid.toFixed(2))
            }
        });
    } catch (error) {
        console.error("Admin - Erro ao buscar estatísticas:", error);
        res.status(500).json({ message: "Erro ao buscar estatísticas." });
    }
});

// 10.9. Gerenciamento de Claims (Admin View) - Inalterado da versão original, revisado para consistência
adminRouter.get('/claims-history', async (req, res) => { // Renomeado para evitar conflito com user claims
    const { userId, planId, currency, page = 1, limit = 20, sort = 'claimedAt', order = 'desc' } = req.query;
    let userQuery = {};
    let aggregationPipeline = [];

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        userQuery._id = new mongoose.Types.ObjectId(userId);
    }
    // Adiciona o match inicial por usuário, se houver
    if (Object.keys(userQuery).length > 0) {
        aggregationPipeline.push({ $match: userQuery });
    }
    
    aggregationPipeline.push({ $unwind: '$claimHistory' }); // Desestrutura o array claimHistory

    // Filtros aplicados aos claims individuais
    const claimFilters = {};
    if (planId && mongoose.Types.ObjectId.isValid(planId)) {
        claimFilters['claimHistory.planId'] = new mongoose.Types.ObjectId(planId);
    }
    if (currency) {
        claimFilters['claimHistory.currency'] = currency.toUpperCase();
    }
    if (Object.keys(claimFilters).length > 0) {
        aggregationPipeline.push({ $match: claimFilters });
    }

    // Lookup para detalhes do plano (opcional, mas bom para ter nome do plano se não estiver no claimHistory)
    aggregationPipeline.push({
        $lookup: {
            from: 'plans', // nome da coleção de planos
            localField: 'claimHistory.planId',
            foreignField: '_id',
            as: 'planDetails'
        }
    });
     // Lookup para detalhes do usuário (necessário para nome/email se não começamos com $match no User)
    if (Object.keys(userQuery).length === 0) { // Se não filtramos por um usuário específico inicialmente
        aggregationPipeline.push({
            $lookup: {
                from: 'users', // nome da coleção de usuários
                localField: 'userId', // Supondo que claimHistory tenha userId se não estiver embutido
                                    // Se claimHistory está embutido, o $unwind já expôs os campos do User.
                                    // Este lookup seria se claimHistory fosse uma coleção separada.
                                    // Como está embutido, os campos do usuário já estão disponíveis.
                foreignField: '_id',
                as: 'userDetails'
            }
        });
    }


    // Contagem total antes da paginação e projeção
    const countPipeline = [...aggregationPipeline, { $count: 'totalCount' }];

    // Ordenação
    const sortOptions = {};
    sortOptions[`claimHistory.${sort}`] = order === 'asc' ? 1 : -1;
    aggregationPipeline.push({ $sort: sortOptions });

    // Paginação
    aggregationPipeline.push({ $skip: (parseInt(page) - 1) * parseInt(limit) });
    aggregationPipeline.push({ $limit: parseInt(limit) });

    // Projeção final dos campos desejados
    aggregationPipeline.push({
        $project: {
            _id: '$claimHistory._id', // ID do claim
            userId: '$_id', // ID do usuário dono do claim
            userName: '$name', // Nome do usuário
            userEmail: '$email', // Email do usuário
            planId: '$claimHistory.planId',
            planName: { $ifNull: [ { $arrayElemAt: ['$planDetails.name', 0] }, '$claimHistory.planName', 'N/A' ] },
            claimNumber: '$claimHistory.claimNumber',
            amount: '$claimHistory.amount',
            currency: '$claimHistory.currency',
            claimedAt: '$claimHistory.claimedAt'
        }
    });

    try {
        const claims = await User.aggregate(aggregationPipeline);
        const totalCountResult = await User.aggregate(countPipeline);
        const totalClaims = totalCountResult.length > 0 ? totalCountResult[0].totalCount : 0;

        res.json({
            claims,
            totalPages: Math.ceil(totalClaims / limit),
            currentPage: parseInt(page),
            totalCount: totalClaims
        });

    } catch (error) {
        console.error("Admin - Erro ao listar histórico de claims:", error);
        res.status(500).json({ message: "Erro ao listar histórico de claims." });
    }
});

// 10.10. Gerenciamento de Promoções Urgentes - ATUALIZADO com upload
// (Countdown estilizado é frontend)
adminRouter.post(
    '/urgent-promotions',
    setUploadPath('promotion-images'),
    upload.single('promotionImageFile'),
    async (req, res) => {
        const { title, description, expiresAt, link, badgeText, isActive = true, imageUrl } = req.body;
        if (!title || !expiresAt) {
            return res.status(400).json({ message: "Título e data de expiração são obrigatórios." });
        }

        let finalImageUrl = imageUrl || '';
        let isLocalFile = false;
        if (req.file) {
            finalImageUrl = `/uploads/promotion-images/${req.file.filename}`;
            isLocalFile = true;
        }

        try {
            const newPromotion = new UrgentPromotion({
                title,
                image: finalImageUrl,
                // isImageLocal: isLocalFile, // Adicionar este campo ao Schema UrgentPromotion se necessário
                description, expiresAt, link, badgeText, isActive
            });
            await newPromotion.save();
            res.status(201).json({ message: "Promoção urgente criada com sucesso.", promotion: newPromotion });
        } catch (error) {
            if (req.file) fs.unlink(path.join(UPLOADS_DIR, 'promotion-images', req.file.filename), err => {});
            console.error("Admin - Erro ao criar promoção urgente:", error);
            res.status(500).json({ message: "Erro ao criar promoção urgente.", error: error.message });
        }
    }
);

adminRouter.get('/urgent-promotions', async (req, res) => { // Listagem
    try {
        const { page = 1, limit = 10, activeOnly } = req.query;
        const query = {};
        if (activeOnly === 'true') { query.isActive = true; query.expiresAt = { $gte: new Date() }; }
        else if (activeOnly === 'false') { query.isActive = false; }

        const promotions = await UrgentPromotion.find(query).sort({ createdAt: -1 })
            .skip((parseInt(page)-1)*parseInt(limit)).limit(parseInt(limit));
        const totalPromotions = await UrgentPromotion.countDocuments(query);
        res.json({ 
            promotions: promotions.map(p => ({...p.toObject(), image: p.image})), // Adicionar isImageLocal se no schema
            totalPages: Math.ceil(totalPromotions/limit), currentPage: parseInt(page), totalCount: totalPromotions });
    } catch (error) {
        console.error("Admin - Erro ao listar promoções urgentes:", error);
        res.status(500).json({ message: "Erro ao listar promoções urgentes." });
    }
});

adminRouter.put(
    '/urgent-promotions/:promotionId',
    setUploadPath('promotion-images'),
    upload.single('promotionImageFile'),
    async (req, res) => {
        const { promotionId } = req.params;
        const { title, description, expiresAt, link, badgeText, isActive, imageUrl, removeCurrentImage } = req.body;

        if (!title || !expiresAt) return res.status(400).json({ message: "Título e data de expiração são obrigatórios." });
        
        try {
            const promotion = await UrgentPromotion.findById(promotionId);
            if (!promotion) {
                 if (req.file) fs.unlink(path.join(UPLOADS_DIR, 'promotion-images', req.file.filename), err => {});
                return res.status(404).json({ message: "Promoção não encontrada." });
            }

            const updateData = { ...req.body };
            delete updateData.promotionImageFile;

            if (req.file) {
                if (promotion.image && promotion.image.startsWith('/uploads/')) { // e se isImageLocal for true
                    fs.unlink(path.join(__dirname, promotion.image), err => {});
                }
                updateData.image = `/uploads/promotion-images/${req.file.filename}`;
                // updateData.isImageLocal = true; // Se no schema
            } else if (removeCurrentImage === 'true' && promotion.image) {
                if (promotion.image && promotion.image.startsWith('/uploads/')) { // e se isImageLocal for true
                    fs.unlink(path.join(__dirname, promotion.image), err => {});
                }
                updateData.image = '';
                // updateData.isImageLocal = false; // Se no schema
            } else if (imageUrl) {
                updateData.image = imageUrl;
                // updateData.isImageLocal = false; // Se no schema
            }

            const updatedPromotion = await UrgentPromotion.findByIdAndUpdate(promotionId, updateData, { new: true, runValidators: true });
            res.json({ message: "Promoção urgente atualizada com sucesso.", promotion: updatedPromotion });
        } catch (error) {
            if (req.file) fs.unlink(path.join(UPLOADS_DIR, 'promotion-images', req.file.filename), err => {});
            console.error("Admin - Erro ao atualizar promoção urgente:", error);
            res.status(500).json({ message: "Erro ao atualizar promoção urgente.", error: error.message });
        }
    }
);

adminRouter.delete('/urgent-promotions/:promotionId', async (req, res) => {
    const { promotionId } = req.params;
    try {
        const deletedPromotion = await UrgentPromotion.findByIdAndDelete(promotionId);
        if (!deletedPromotion) return res.status(404).json({ message: "Promoção não encontrada." });
        if (deletedPromotion.image && deletedPromotion.image.startsWith('/uploads/')) { // e se isImageLocal for true
            fs.unlink(path.join(__dirname, deletedPromotion.image), err => {
                if(err) console.warn("Admin - Erro ao deletar imagem de promoção:", err.message)
            });
        }
        res.json({ message: "Promoção urgente deletada com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar promoção urgente:", error);
        res.status(500).json({ message: "Erro ao deletar promoção urgente." });
    }
});

// 10.11. Gerenciamento de Banners da Homepage - ATUALIZADO com upload e sem cor de fundo
adminRouter.post(
    '/homepage-banners',
    setUploadPath('banners'), // Define subpasta para banners
    upload.single('bannerMediaFile'), // 'bannerMediaFile' no form-data
    async (req, res) => {
        const {
            title, mediaType, videoPlatform, textOverlay,
            ctaText, ctaLink, textColor, order = 0, isActive = true,
            mediaUrl // URL externa se não houver upload
        } = req.body;

        if (!mediaType) {
            return res.status(400).json({ message: "Tipo de mídia é obrigatório." });
        }
        if (mediaType === 'video' && !videoPlatform) {
            // Se for upload local de vídeo, platform pode ser 'local'
            // if (videoPlatform !== 'local' && !mediaUrl && !req.file) return res.status(400).json({ message: "URL da mídia ou arquivo é obrigatório para vídeo." });
        }
        if (mediaType === 'video' && videoPlatform && !['youtube', 'vimeo', 'local', 'other'].includes(videoPlatform)) {
             return res.status(400).json({ message: "Plataforma de vídeo inválida." });
        }


        let finalMediaUrl = mediaUrl || '';
        let isLocalFile = false;

        if (req.file) {
            finalMediaUrl = `/uploads/banners/${req.file.filename}`;
            isLocalFile = true;
            if (mediaType === 'video' && !videoPlatform) { // Se é upload de vídeo e não especificou plataforma
                updateData.videoPlatform = 'local';
            }
        }
        
        if (!finalMediaUrl) {
             return res.status(400).json({ message: "URL da mídia ou arquivo de upload é obrigatório." });
        }


        try {
            const newBanner = new HomepageBanner({
                title, mediaType, mediaUrl: finalMediaUrl, videoPlatform: videoPlatform || (isLocalFile && mediaType === 'video' ? 'local' : 'other'),
                textOverlay, ctaText, ctaLink, textColor, order: parseInt(order), isActive,
                isLocalFile // Salva se o arquivo é local
            });
            await newBanner.save();
            res.status(201).json({ message: "Banner da homepage criado com sucesso.", banner: newBanner });
        } catch (error) {
            if (req.file) fs.unlink(path.join(UPLOADS_DIR, 'banners', req.file.filename), err => {}); // Limpa upload em caso de erro
            console.error("Admin - Erro ao criar banner da homepage:", error);
            res.status(500).json({ message: "Erro ao criar banner.", error: error.message });
        }
    }
);

adminRouter.get('/homepage-banners', async (req, res) => { // Listagem
    try {
        const { page = 1, limit = 10, activeOnly } = req.query;
        const query = {};
        if (activeOnly === 'true') query.isActive = true;
        else if (activeOnly === 'false') query.isActive = false;

        const banners = await HomepageBanner.find(query)
            .sort({ order: 1, createdAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));
        const totalBanners = await HomepageBanner.countDocuments(query);
        res.json({ banners, totalPages: Math.ceil(totalBanners / limit), currentPage: parseInt(page), totalCount: totalBanners });
    } catch (error) {
        console.error("Admin - Erro ao listar banners da homepage:", error);
        res.status(500).json({ message: "Erro ao listar banners." });
    }
});

adminRouter.put(
    '/homepage-banners/:bannerId',
    setUploadPath('banners'),
    upload.single('bannerMediaFile'),
    async (req, res) => {
        const { bannerId } = req.params;
        const {
            title, mediaType, videoPlatform, textOverlay,
            ctaText, ctaLink, textColor, order, isActive,
            mediaUrl, removeCurrentMedia // URL externa ou flag para remover
        } = req.body;

        if (mediaType && mediaType === 'video' && videoPlatform && !['youtube', 'vimeo', 'local', 'other'].includes(videoPlatform)) {
             return res.status(400).json({ message: "Plataforma de vídeo inválida." });
        }

        try {
            const banner = await HomepageBanner.findById(bannerId);
            if (!banner) {
                if (req.file) fs.unlink(path.join(UPLOADS_DIR, 'banners', req.file.filename), err => {});
                return res.status(404).json({ message: "Banner não encontrado." });
            }

            const updateData = { ...req.body }; // Pega todos os campos do body
            delete updateData.bannerMediaFile; // Remove o campo do arquivo do objeto de atualização

            if (req.file) { // Novo arquivo enviado
                if (banner.isLocalFile && banner.mediaUrl) { // Remove o arquivo local antigo
                    fs.unlink(path.join(__dirname, banner.mediaUrl), err => {
                        if (err) console.warn("Admin - Erro ao remover mídia antiga do banner:", err.message);
                    });
                }
                updateData.mediaUrl = `/uploads/banners/${req.file.filename}`;
                updateData.isLocalFile = true;
                if (updateData.mediaType === 'video' && !updateData.videoPlatform) {
                     updateData.videoPlatform = 'local';
                }
            } else if (removeCurrentMedia === 'true' && banner.mediaUrl) {
                if (banner.isLocalFile) {
                    fs.unlink(path.join(__dirname, banner.mediaUrl), err => {
                        if (err) console.warn("Admin - Erro ao remover mídia atual do banner:", err.message);
                    });
                }
                updateData.mediaUrl = ''; // Limpa a URL/path
                updateData.isLocalFile = false;
            } else if (mediaUrl) { // Se uma nova URL externa for fornecida e não houver upload
                if (banner.isLocalFile && banner.mediaUrl) { // Remove o arquivo local antigo se estiver mudando para URL
                    fs.unlink(path.join(__dirname, banner.mediaUrl), err => {});
                }
                updateData.mediaUrl = mediaUrl;
                updateData.isLocalFile = false;
            }
            if (order) updateData.order = parseInt(order);
            updateData.updatedAt = Date.now();

            const updatedBanner = await HomepageBanner.findByIdAndUpdate(bannerId, updateData, { new: true, runValidators: true });
            res.json({ message: "Banner da homepage atualizado com sucesso.", banner: updatedBanner });
        } catch (error) {
            if (req.file) fs.unlink(path.join(UPLOADS_DIR, 'banners', req.file.filename), err => {});
            console.error("Admin - Erro ao atualizar banner da homepage:", error);
            res.status(500).json({ message: "Erro ao atualizar banner.", error: error.message });
        }
    }
);

adminRouter.delete('/homepage-banners/:bannerId', async (req, res) => {
    const { bannerId } = req.params;
    try {
        const deletedBanner = await HomepageBanner.findByIdAndDelete(bannerId);
        if (!deletedBanner) return res.status(404).json({ message: "Banner não encontrado." });
        if (deletedBanner.isLocalFile && deletedBanner.mediaUrl) { // Remove arquivo local se existir
            fs.unlink(path.join(__dirname, deletedBanner.mediaUrl), err => {
                if(err) console.warn("Admin - Erro ao deletar mídia de banner:", err.message);
            });
        }
        res.json({ message: "Banner da homepage deletado com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar banner da homepage:", error);
        res.status(500).json({ message: "Erro ao deletar banner." });
    }
});


// 10.12. Gerenciamento do Blog (Admin)
// Blog Categories Router (já definido no original, apenas montando)
const blogCategoryRouter = express.Router(); // Assumindo que já foi definido como no original
// ... (Colar aqui as rotas CRUD de BlogCategory do código original, adaptando se necessário)
// Exemplo (simplificado, colar o código completo original):
blogCategoryRouter.post('/', async (req, res) => { /* ... Lógica original ... */ });
blogCategoryRouter.get('/', async (req, res) => { /* ... Lógica original ... */ });
blogCategoryRouter.get('/:categoryId', async (req, res) => { /* ... Lógica original ... */ });
blogCategoryRouter.put('/:categoryId', async (req, res) => { /* ... Lógica original ... */ });
blogCategoryRouter.delete('/:categoryId', async (req, res) => { /* ... Lógica original ... */ });
adminRouter.use('/blog/categories', blogCategoryRouter);


// Blog Tags Router (já definido no original, apenas montando)
const blogTagRouter = express.Router();  // Assumindo que já foi definido como no original
// ... (Colar aqui as rotas CRUD de BlogTag do código original, adaptando se necessário)
blogTagRouter.post('/', async (req, res) => { /* ... Lógica original ... */ });
blogTagRouter.get('/', async (req, res) => { /* ... Lógica original ... */ });
blogTagRouter.get('/:tagId', async (req, res) => { /* ... Lógica original ... */ });
blogTagRouter.put('/:tagId', async (req, res) => { /* ... Lógica original ... */ });
blogTagRouter.delete('/:tagId', async (req, res) => { /* ... Lógica original ... */ });
adminRouter.use('/blog/tags', blogTagRouter);


// Blog Posts Router - ATUALIZADO com upload de coverImage
const blogPostRouter = express.Router();

blogPostRouter.post(
    '/',
    setUploadPath('blog-covers'),
    upload.single('coverImageFile'),
    async (req, res) => {
        const { title, slug, content, excerpt, category, tags, status, isFeatured, publishedAt, seoTitle, seoDescription, seoKeywords, coverImageUrl } = req.body;
        if (!title || !content) return res.status(400).json({ message: "Título e conteúdo são obrigatórios." });
        // ... (validações de status e publishedAt do original)

        let finalCoverImage = coverImageUrl || '';
        let isLocal = false;
        if (req.file) {
            finalCoverImage = `/uploads/blog-covers/${req.file.filename}`;
            isLocal = true;
        }

        try {
            let postSlug = slug;
            if (!slug && title) { postSlug = title.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, ''); }
            const existingPost = await BlogPost.findOne({ slug: postSlug });
            if (existingPost) {
                if(req.file) fs.unlink(path.join(UPLOADS_DIR,'blog-covers', req.file.filename), err => {});
                return res.status(409).json({ message: "Post com este slug já existe." });
            }
            
            let finalPublishedAt = publishedAt;
            if (status === 'published' && !publishedAt) finalPublishedAt = new Date();
            else if (status !== 'scheduled' && status !== 'published') finalPublishedAt = null;

            const newPost = new BlogPost({
                title, slug: postSlug, content, excerpt,
                coverImage: finalCoverImage,
                isCoverImageLocal: isLocal,
                category: category || null,
                tags: tags ? (Array.isArray(tags) ? tags : JSON.parse(tags)) : [],
                author: req.user.id, // ID do admin logado
                status, isFeatured: isFeatured === 'true', publishedAt: finalPublishedAt,
                seoTitle, seoDescription, seoKeywords: seoKeywords ? (Array.isArray(seoKeywords) ? seoKeywords : JSON.parse(seoKeywords)) : []
            });
            await newPost.save();
            res.status(201).json(newPost);
        } catch (error) {
            if (req.file) fs.unlink(path.join(UPLOADS_DIR,'blog-covers', req.file.filename), err => {});
            if (error.code === 11000) return res.status(409).json({ message: "Post com este slug já existe (erro de duplicidade)." });
            console.error("Admin - Erro ao criar post do blog:", error);
            res.status(500).json({ message: "Erro ao criar post.", error: error.message });
        }
    }
);

blogPostRouter.get('/', async (req, res) => { // Listagem - Original adaptado para popular author
    const { page = 1, limit = 10, search = '', status, category, tag, author, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const query = {};
    if (search) { query.$or = [ { title: { $regex: search, $options: 'i' } }, { content: { $regex: search, $options: 'i' } } ]; }
    if (status) query.status = status;
    if (category) query.category = category; 
    if (tag) query.tags = tag; 
    if (author) query.author = author;
    try {
        const posts = await BlogPost.find(query)
            .populate('category', 'name slug')
            .populate('tags', 'name slug')
            .populate('author', 'name email') // Popula o autor
            .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));
        const totalPosts = await BlogPost.countDocuments(query);
        res.json({ posts, totalPages: Math.ceil(totalPosts / limit), currentPage: parseInt(page), totalCount: totalPosts });
    } catch (error) {
        console.error("Admin - Erro ao listar posts do blog:", error);
        res.status(500).json({ message: "Erro ao listar posts." });
    }
});

blogPostRouter.get('/:postId', async (req, res) => { // Original, sem mudanças grandes
    try {
        const post = await BlogPost.findById(req.params.postId)
            .populate('category', 'name slug _id') 
            .populate('tags', 'name slug _id') 
            .populate('author', 'name email');
        if (!post) return res.status(404).json({ message: "Post não encontrado." });
        res.json(post);
    } catch (error) {
        console.error("Admin - Erro ao buscar post do blog:", error);
        res.status(500).json({ message: "Erro ao buscar post." });
    }
});

blogPostRouter.put(
    '/:postId',
    setUploadPath('blog-covers'),
    upload.single('coverImageFile'),
    async (req, res) => {
        const { postId } = req.params;
        const { title, slug, content, excerpt, category, tags, status, isFeatured, publishedAt, seoTitle, seoDescription, seoKeywords, coverImageUrl, removeCurrentCoverImage } = req.body;

        if (!title || !content) return res.status(400).json({ message: "Título e conteúdo são obrigatórios." });
        // ... (validações de status e publishedAt do original)

        try {
            const post = await BlogPost.findById(postId);
            if (!post) {
                if(req.file) fs.unlink(path.join(UPLOADS_DIR,'blog-covers', req.file.filename), err => {});
                return res.status(404).json({ message: "Post não encontrado." });
            }

            const updateData = { ...req.body };
            delete updateData.coverImageFile;

            if (req.file) {
                if (post.isCoverImageLocal && post.coverImage) {
                    fs.unlink(path.join(__dirname, post.coverImage), err => {});
                }
                updateData.coverImage = `/uploads/blog-covers/${req.file.filename}`;
                updateData.isCoverImageLocal = true;
            } else if (removeCurrentCoverImage === 'true' && post.coverImage) {
                if (post.isCoverImageLocal) {
                     fs.unlink(path.join(__dirname, post.coverImage), err => {});
                }
                updateData.coverImage = '';
                updateData.isCoverImageLocal = false;
            } else if (coverImageUrl) {
                 if (post.isCoverImageLocal && post.coverImage) { // Mudando de local para URL
                    fs.unlink(path.join(__dirname, post.coverImage), err => {});
                }
                updateData.coverImage = coverImageUrl;
                updateData.isCoverImageLocal = false;
            }
            
            if (slug) {
                let postSlug = slug;
                if (title && !slug) postSlug = title.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
                const existingPostWithSlug = await BlogPost.findOne({ slug: postSlug, _id: { $ne: postId } });
                if (existingPostWithSlug) return res.status(409).json({ message: "Outro post com este slug já existe." });
                updateData.slug = postSlug;
            }

            // Lógica de publishedAt (do original)
            let finalPublishedAt = publishedAt ? new Date(publishedAt) : post.publishedAt;
            if (status === 'published' && (!post.publishedAt || post.status !== 'published')) {
                finalPublishedAt = new Date();
            } else if (status === 'scheduled') {
                if (new Date(finalPublishedAt) <= new Date() && (!post.publishedAt || new Date(finalPublishedAt).toISOString() !== new Date(post.publishedAt).toISOString() )) {
                    // ... (lógica de validação de data futura do original)
                }
            } else if (status !== 'scheduled' && status !== 'published') {
                finalPublishedAt = null;
            }
            updateData.publishedAt = finalPublishedAt;
            updateData.updatedAt = new Date();
            if (tags) updateData.tags = Array.isArray(tags) ? tags : JSON.parse(tags);
            if (seoKeywords) updateData.seoKeywords = Array.isArray(seoKeywords) ? seoKeywords : JSON.parse(seoKeywords);
            if (category === '' || category === 'null') updateData.category = null;


            const updatedPost = await BlogPost.findByIdAndUpdate(postId, updateData, { new: true, runValidators: true });
            res.json(updatedPost);
        } catch (error) {
            if(req.file) fs.unlink(path.join(UPLOADS_DIR,'blog-covers', req.file.filename), err => {});
            if (error.code === 11000) return res.status(409).json({ message: "Post com este slug já existe (erro de duplicidade)." });
            console.error("Admin - Erro ao atualizar post do blog:", error);
            res.status(500).json({ message: "Erro ao atualizar post.", error: error.message });
        }
    }
);

blogPostRouter.delete('/:postId', async (req, res) => { // Original, adaptado para deletar imagem
    try {
        const deletedPost = await BlogPost.findByIdAndDelete(req.params.postId);
        if (!deletedPost) return res.status(404).json({ message: "Post não encontrado." });
        if (deletedPost.isCoverImageLocal && deletedPost.coverImage) {
            fs.unlink(path.join(__dirname, deletedPost.coverImage), err => {
                if(err) console.warn("Admin - Erro ao deletar imagem de capa do post:", err.message);
            });
        }
        res.json({ message: "Post deletado com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar post do blog:", error);
        res.status(500).json({ message: "Erro ao deletar post." });
    }
});
adminRouter.use('/blog/posts', blogPostRouter);


// NOVO: Admin View para Histórico de Referências
adminRouter.get('/referral-history', async (req, res) => {
    const { page = 1, limit = 20, referrerId, referredId, status, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const query = {};

    if (referrerId && mongoose.Types.ObjectId.isValid(referrerId)) query.referrerId = referrerId;
    if (referredId && mongoose.Types.ObjectId.isValid(referredId)) query.referredId = referredId;
    if (status) query.status = status;

    try {
        const referrals = await ReferralHistory.find(query)
            .populate('referrerId', 'name email')
            .populate('referredId', 'name email')
            .populate('firstPlanActivatedByReferred', 'name investmentAmount')
            .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        const totalReferrals = await ReferralHistory.countDocuments(query);

        res.json({
            referrals,
            totalPages: Math.ceil(totalReferrals / limit),
            currentPage: parseInt(page),
            totalCount: totalReferrals
        });
    } catch (error) {
        console.error("Admin - Erro ao listar histórico de referências:", error);
        res.status(500).json({ message: "Erro ao listar histórico de referências." });
    }
});

// NOVO: Admin View para Logs de Comissão de Claims Diários
adminRouter.get('/daily-claim-commission-logs', async (req, res) => {
    const { page = 1, limit = 20, referrerId, referredId, dateFrom, dateTo, sortBy = 'paidAt', sortOrder = 'desc' } = req.query;
    const query = {};

    if (referrerId && mongoose.Types.ObjectId.isValid(referrerId)) query.referrerId = referrerId;
    if (referredId && mongoose.Types.ObjectId.isValid(referredId)) query.referredId = referredId;
    if (dateFrom) query.date = { ...query.date, $gte: new Date(dateFrom) };
    if (dateTo) query.date = { ...query.date, $lte: new Date(new Date(dateTo).setHours(23,59,59,999)) };


    try {
        const logs = await DailyClaimCommissionLog.find(query)
            .populate('referrerId', 'name email')
            .populate('referredId', 'name email')
            .populate({
                path: 'referralHistoryId',
                select: 'createdAt status'
            })
            .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));

        const totalLogs = await DailyClaimCommissionLog.countDocuments(query);

        res.json({
            logs,
            totalPages: Math.ceil(totalLogs / limit),
            currentPage: parseInt(page),
            totalCount: totalLogs
        });
    } catch (error) {
        console.error("Admin - Erro ao listar logs de comissão de claims:", error);
        res.status(500).json({ message: "Erro ao listar logs de comissão de claims." });
    }
});

// server.js

// ... outras partes do seu código ...

adminRouter.get('/stats/overview', async (req, res) => {
    console.log("ADMIN_STATS_LOG: Rota /api/admin/stats/overview alcançada."); // LOG 1

    try {
        console.log("ADMIN_STATS_LOG: Tentando buscar totalUsers...");
        const totalUsers = await User.countDocuments();
        console.log("ADMIN_STATS_LOG: totalUsers =", totalUsers);

        console.log("ADMIN_STATS_LOG: Tentando buscar activeUsers...");
        const activeUsers = await User.countDocuments({ lastLoginAt: { $gte: new Date(new Date() - 30 * 24 * 60 * 60 * 1000) } });
        console.log("ADMIN_STATS_LOG: activeUsers =", activeUsers);

        console.log("ADMIN_STATS_LOG: Tentando agregar depósitos...");
        const depositAggregation = await Deposit.aggregate([
            { $match: { status: 'Confirmado' } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);
        const totalDeposited = depositAggregation.length > 0 ? depositAggregation[0].total : 0;
        const totalDepositsConfirmed = depositAggregation.length > 0 ? depositAggregation[0].count : 0;
        console.log("ADMIN_STATS_LOG: totalDeposited =", totalDeposited);

        console.log("ADMIN_STATS_LOG: Tentando agregar saques...");
        const withdrawalAggregation = await Withdrawal.aggregate([
            { $match: { status: 'Processado' } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);
        const totalWithdrawn = withdrawalAggregation.length > 0 ? withdrawalAggregation[0].total : 0;
        const totalWithdrawalsProcessed = withdrawalAggregation.length > 0 ? withdrawalAggregation[0].count : 0;
        console.log("ADMIN_STATS_LOG: totalWithdrawn =", totalWithdrawn);

        console.log("ADMIN_STATS_LOG: Tentando contar depósitos pendentes...");
        const pendingDepositsCount = await Deposit.countDocuments({ status: 'Pendente' });
        console.log("ADMIN_STATS_LOG: pendingDepositsCount =", pendingDepositsCount);

        console.log("ADMIN_STATS_LOG: Tentando contar saques pendentes...");
        const pendingWithdrawalsCount = await Withdrawal.countDocuments({ status: 'Pendente' });
        console.log("ADMIN_STATS_LOG: pendingWithdrawalsCount =", pendingWithdrawalsCount);

        console.log("ADMIN_STATS_LOG: Tentando buscar planos ativos...");
        const plans = await Plan.find({ isActive: true }).select('name _id');
        const activeInvestmentsByPlan = {};
        let totalActiveInvestments = 0;
        console.log("ADMIN_STATS_LOG: Iterando sobre planos para contar investimentos ativos...");
        for (const plan of plans) {
            console.log(`ADMIN_STATS_LOG: Contando para o plano ${plan.name}...`);
            const count = await User.countDocuments({ 
                'activeInvestments.planId': plan._id, 
                'activeInvestments.expiresAt': { $or: [null, { $gt: new Date() }] } 
            });
            activeInvestmentsByPlan[plan.name] = count;
            totalActiveInvestments += count;
        }
        console.log("ADMIN_STATS_LOG: activeInvestmentsByPlan =", activeInvestmentsByPlan);

        console.log("ADMIN_STATS_LOG: Tentando agregar comissões de registro...");
        const totalCommissionOnRegistration = await ReferralHistory.aggregate([
            { $match: { status: 'Comissão Paga', commissionEarnedOnRegistration: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: '$commissionEarnedOnRegistration' } } }
        ]);
        const totalRegCommissionPaid = totalCommissionOnRegistration.length > 0 ? totalCommissionOnRegistration[0].total : 0;
        console.log("ADMIN_STATS_LOG: totalRegCommissionPaid =", totalRegCommissionPaid);

        console.log("ADMIN_STATS_LOG: Tentando agregar comissões de claims...");
        const totalCommissionOnClaims = await DailyClaimCommissionLog.aggregate([
            { $group: { _id: null, total: { $sum: '$commissionEarned' } } }
        ]);
        const totalClaimCommissionPaid = totalCommissionOnClaims.length > 0 ? totalCommissionOnClaims[0].total : 0;
        console.log("ADMIN_STATS_LOG: totalClaimCommissionPaid =", totalClaimCommissionPaid);
        
        const totalOverallCommissionPaid = totalRegCommissionPaid + totalClaimCommissionPaid;

        console.log("ADMIN_STATS_LOG: Todas as estatísticas buscadas com sucesso. Enviando resposta.");
        res.json({
            totalUsers,
            activeUsers,
            totalDeposited,
            totalDepositsConfirmed,
            totalWithdrawn,
            totalWithdrawalsProcessed,
            pendingDepositsCount,
            pendingWithdrawalsCount,
            activeInvestmentsByPlan,
            totalActiveInvestments,
            totalCommissionPaid: {
                registration: parseFloat(totalRegCommissionPaid.toFixed(2)),
                claims: parseFloat(totalClaimCommissionPaid.toFixed(2)),
                overall: parseFloat(totalOverallCommissionPaid.toFixed(2))
            }
        });
    } catch (error) {
        // Logs detalhados do erro no backend
        console.error("ADMIN_STATS_LOG: ERRO DETALHADO NO BLOCO CATCH da rota /api/admin/stats/overview");
        console.error("ADMIN_STATS_LOG: Nome do Erro:", error.name);
        console.error("ADMIN_STATS_LOG: Mensagem do Erro:", error.message);
        console.error("ADMIN_STATS_LOG: Stack Trace do Erro:", error.stack);
        console.error("ADMIN_STATS_LOG: Objeto de Erro Completo:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2)); // Tenta serializar o erro

        res.status(500).json({ message: "Erro ao buscar estatísticas." });
    }
});

// ... resto do seu server.js ...
// Montar o adminRouter principal no app
app.use('/api/admin', adminRouter);


// -----------------------------------------------------------------------------
// ROTA RAIZ (Exemplo) E TRATAMENTO DE ERROS (Final do arquivo)
// -----------------------------------------------------------------------------
app.get('/api', (req, res) => {
    res.json({ message: 'Bem-vindo à API da Plataforma de Investimentos GoldMT! Versão atualizada.' });
});

// Middleware para tratar rotas não encontradas (404)
app.use((req, res, next) => {
    res.status(404).json({ message: 'Endpoint não encontrado.' });
});

// Middleware de tratamento de erro genérico (deve ser o último middleware)
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
    console.error("Erro não tratado:", error);
    const status = error.status || 500;
    let message = 'Erro interno do servidor.';
    if (status < 500 && error.message) { // Para erros como bad request com mensagens específicas
        message = error.message;
    }
    // Se for um erro do multer por tamanho de arquivo
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: `Arquivo muito grande. O limite é de ${error.limit / (1024*1024)}MB.`})
    }
    // Se for erro de tipo de arquivo não suportado (que definimos no fileFilter)
    if (error.message && error.message.includes('Tipo de arquivo não suportado')) {
        return res.status(400).json({ message: error.message });
    }

    res.status(status).json({ message });
});

// -----------------------------------------------------------------------------
// INICIALIZAÇÃO DO SERVIDOR
// -----------------------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
    app.listen(PORT, '0.0.0.0', () => { // Escuta em todas as interfaces de rede em produção
        console.log(`Servidor rodando em modo de PRODUÇÃO na porta ${PORT} e acessível externamente.`);
        console.log(`Frontend URL configurada: ${FRONTEND_URL}`);
        console.log(`Uploads sendo salvos em: ${UPLOADS_DIR}`);
    });
} else {
    app.listen(PORT, () => {
       console.log(`Servidor rodando em modo de DESENVOLVIMENTO na porta ${PORT}`);
       console.log(`Frontend URL configurada: ${FRONTEND_URL}`);
       console.log(`Uploads sendo salvos em: ${UPLOADS_DIR}`);
       console.log(`Acesse os uploads em: http://localhost:${PORT}/uploads/<subpasta>/<nomearquivo>`);
    });
}

// Fim do arquivo server.js