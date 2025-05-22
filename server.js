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
// server.js
// ... (continuação da Parte 4: MODELOS (SCHEMAS) DO MONGODB - que acabamos de passar)

// -----------------------------------------------------------------------------
// CONEXÃO COM O MONGODB (Movida para após a definição dos modelos)
// -----------------------------------------------------------------------------
mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    // useCreateIndex: true, // Removido, não mais necessário nas versões recentes do Mongoose/MongoDB driver
    // useFindAndModify: false, // Removido, não mais necessário
})
.then(async () => { 
    console.log('MongoDB conectado com sucesso!'); 
    
    // Chama as funções de inicialização APÓS os modelos serem definidos e o DB conectado.
    // É importante que AdminSetting e User estejam definidos antes dessas chamadas.
    await createInitialAdmin(); 
    await initializeDefaultSettings(); // << ADIÇÃO DA CHAMADA DA NOVA FUNÇÃO AQUI
    
    // A função getSiteSettings() é chamada dentro de initializeDefaultSettings
    // para popular o cache inicial com todas as configurações, incluindo as novas.
    // Não é estritamente necessário chamá-la novamente aqui de forma explícita
    // a menos que queira garantir uma nova carga por algum motivo específico.
    // await getSiteSettings(); 
})
.catch(err => console.error('Erro ao conectar ao MongoDB:', err));
// server.js
// ... (continuação da CONEXÃO COM O MONGODB E CHAMADA DAS FUNÇÕES DE INICIALIZAÇÃO)

// -----------------------------------------------------------------------------
// 5. FUNÇÕES UTILITÁRIAS
// -----------------------------------------------------------------------------

// Gerar Token JWT
const generateToken = (userId, isAdmin = false) => {
    return jwt.sign({ id: userId, isAdmin }, JWT_SECRET, { expiresIn: '24h' }); // Token expira em 24 horas
};

// Middleware de Autenticação JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ message: 'Acesso não autorizado: Token não fornecido.' }); //
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error("Erro na verificação do JWT:", err.message); //
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({ message: 'Token expirado. Por favor, faça login novamente.' }); //
            }
            return res.status(403).json({ message: 'Token inválido.' }); //
        }
        req.user = decoded; // Adiciona o payload decodificado (id, isAdmin) ao objeto req
        next();
    });
};

// Middleware de Autorização de Admin
const authorizeAdmin = (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ message: 'Acesso negado: Recurso exclusivo para administradores.' }); //
    }
    next();
};

// Função para buscar configurações do admin (cache simples para evitar múltiplas buscas ao DB)
let siteSettingsCache = null;
async function getSiteSettings() {
    if (siteSettingsCache && Object.keys(siteSettingsCache).length > 0) {
        // console.log("Usando configurações do site do cache."); // Log para debug
        return siteSettingsCache;
    }
    try {
        const AdminSetting = mongoose.model('AdminSetting'); // Garante que o modelo está carregado
        const settings = await AdminSetting.find({}); //
        const formattedSettings = {};
        settings.forEach(setting => {
            formattedSettings[setting.key] = setting.value; //
        });
        siteSettingsCache = formattedSettings; //
        // console.log("Configurações do site carregadas/recarregadas no cache pela função getSiteSettings.");
        return formattedSettings;
    } catch (error) {
        console.error("Erro ao buscar configurações do site em getSiteSettings:", error); //
        return {}; // Retorna objeto vazio em caso de erro
    }
}
// A chamada inicial de getSiteSettings() é feita em initializeDefaultSettings()
// server.js
// ... (continuação da Parte 5: FUNÇÕES UTILITÁRIAS)

// -----------------------------------------------------------------------------
// 6. CRON JOBS
// -----------------------------------------------------------------------------

// Roda todos os dias à meia-noite (00:00) para resetar claims diários


// Cron Job: Publicar Posts Agendados
// Roda a cada 5 minutos (ajuste conforme necessário)
cron.schedule('*/5 * * * *', async () => {
    console.log('Executando cron job: Verificando posts de blog agendados...');
    try {
        const now = new Date();
        // Usar o modelo BlogPost que foi definido na Parte 2
        const postsToPublish = await BlogPost.find({
            status: 'scheduled',
            publishedAt: { $lte: now }
        });

        if (postsToPublish.length > 0) {
            for (const post of postsToPublish) {
                post.status = 'published';
                if (!post.publishedAt) { // Segurança, embora deva ser definido no agendamento
                    post.publishedAt = now;
       // server.js
// ...
// -----------------------------------------------------------------------------
// 6. CRON JOBS
// -----------------------------------------------------------------------------

// Roda todos os dias à meia-noite (00:00) de Maputo para resetar claims diários
cron.schedule('0 0 * * *', async () => {
    console.log('Executando cron job: Resetando claims diários para o fuso de Maputo...'); //
    try {
        const usersWithActiveInvestments = await User.find({
            'activeInvestments.0': { $exists: true } // Pelo menos um investimento ativo //
        });

        let resetCount = 0;
        for (const user of usersWithActiveInvestments) {
            let userModified = false;
            for (const investment of user.activeInvestments) {
                if (investment.claimsMadeToday > 0) { //
                    // Se o cron está rodando, é um novo dia no fuso horário de Maputo.
                    // Resetamos os claims feitos no "dia anterior".
                    investment.claimsMadeToday = 0; //
                    // Opcional: Limpar a lastClaimDate para evitar confusões futuras, 
                    // embora não seja estritamente necessário para ESTA lógica de reset.
                    // investment.lastClaimDate = undefined; 
                    userModified = true;
                }
            }
            if (userModified) {
                await user.save(); //
                resetCount++;
                // console.log(`Claims resetados para o usuário ${user.email} no início do dia de Maputo.`); // Log individual pode ser verboso
            }
        }
        if (resetCount > 0) {
            console.log(`Cron job: Claims diários resetados para ${resetCount} usuário(s) (Maputo).`);
        } else {
            console.log('Cron job: Nenhum claim precisou ser resetado (Maputo).');
        }
        console.log('Cron job: Reset de claims diários (Maputo) concluído.'); //
    } catch (error) {
        console.error('Erro no cron job de reset de claims (Maputo):', error); //
    }
}, {
    scheduled: true,
    timezone: "Africa/Maputo" // Garante que o job rode à meia-noite no fuso de Maputo //
});

// ... (resto do código, incluindo o cron job de posts agendados)         }
                post.updatedAt = now;
                await post.save();
                console.log(`Post do blog "${post.title}" (ID: ${post._id}) publicado via agendamento.`);
            }
            console.log(`${postsToPublish.length} post(s) do blog foram publicados.`);
        } else {
            // console.log('Nenhum post de blog agendado para publicação no momento.'); // Log opcional
        }
    } catch (error) {
        console.error('Erro no cron job de publicação de posts agendados:', error);
    }
}, {
    scheduled: true,
    timezone: "Africa/Maputo" // Consistência de fuso horário
});
// server.js
// ... (continuação da Parte 6: CRON JOBS)

// -----------------------------------------------------------------------------
// 7. ROTAS DE AUTENTICAÇÃO
// -----------------------------------------------------------------------------
const authRouter = express.Router();

// 7.1. Rota de Cadastro (POST /api/auth/register)
// <<< ESTA ROTA FOI ATUALIZADA PARA GERENCIAR O BÔNUS DE CADASTRO DINAMICAMENTE >>>
authRouter.post('/register', async (req, res) => {
    const { name, email, password, securityQuestion, securityAnswer, referralCode: referredByCode } = req.body;

    // Validação básica
    if (!name || !email || !password || !securityQuestion || !securityAnswer) {
        return res.status(400).json({ message: 'Todos os campos obrigatórios devem ser preenchidos.' }); 
    }
    if (password.length < 6) {
        return res.status(400).json({ message: 'A senha deve ter pelo menos 6 caracteres.' }); 
    }

    try {
        // Verificar se o email já existe
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
        }

        // --- INÍCIO DA LÓGICA DE BÔNUS ATUALIZADA ---
        const siteConfig = await getSiteSettings(); // Busca todas as configurações do site (do cache ou DB)
        
        let calculatedBonus = 0;
        // Verifica se a configuração para ativar o bônus existe e é true
        const isBonusActive = siteConfig.isRegistrationBonusActive === true; // Verifica explicitamente por true
        const bonusAmountSetting = siteConfig.registrationBonusAmount;

        if (isBonusActive) {
            if (typeof bonusAmountSetting === 'number' && bonusAmountSetting >= 0) {
                calculatedBonus = bonusAmountSetting;
            } else {
                // Fallback se 'registrationBonusAmount' não estiver definido ou não for um número válido,
                // mas 'isRegistrationBonusActive' for true.
                // O valor padrão de 200 foi definido em initializeDefaultSettings,
                // este log serve como um aviso se, por algum motivo, a configuração não for encontrada ou for inválida.
                calculatedBonus = 0; // Default seguro para não dar bônus se o valor não for numérico
                console.warn(`AVISO: Bônus de cadastro está ativo, mas a configuração 'registrationBonusAmount' (${bonusAmountSetting}) não é um número válido ou não foi encontrada nas AdminSettings. Bônus de cadastro definido como ${calculatedBonus}.`);
            }
        }
        // --- FIM DA LÓGICA DE BÔNUS ATUALIZADA ---

        const newUser = new User({
            name,
            email: email.toLowerCase(),
            password, // Hashing é feito pelo hook pre-save do UserSchema
            securityQuestion,
            securityAnswer, // Hashing é feito pelo hook pre-save do UserSchema
            referredBy: referrer ? referrer._id : null, 
            balance: { MT: 0 }, 
            bonusBalance: calculatedBonus, // << USA O BÔNUS CALCULADO A PARTIR DAS CONFIGURAÇÕES
        });

        await newUser.save(); 

        // Se foi referido, criar registro em ReferralHistory
        // O bônus de 65MT para o referrer será creditado quando o novo usuário fizer o primeiro depósito.
        if (referrer) {
            const referralEntry = new ReferralHistory({
                referrerId: referrer._id, 
                referredId: newUser._id, 
                status: 'Pendente', // Aguardando primeiro depósito do novo usuário
                bonusAmount: 65 // Este valor também poderia vir de AdminSettings se desejado
            });
            await referralEntry.save(); 
        }

        const token = generateToken(newUser._id, newUser.isAdmin); 

        // Mensagem de sucesso dinâmica baseada no bônus concedido
        let successMessage = 'Usuário cadastrado com sucesso!';
        if (calculatedBonus > 0) { // Adiciona info do bônus apenas se algum bônus foi dado
            successMessage += ` Bônus de ${calculatedBonus} MT adicionado.`;
        }
        successMessage += ' Lembre-se de salvar sua pergunta e resposta de segurança.';

        res.status(201).json({
            message: successMessage,
            token,
            user: { // Retorna apenas os dados não sensíveis do usuário
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
            // Erro de duplicidade de código de referência (raro, mas possível)
            return res.status(500).json({ message: 'Erro ao gerar informações do usuário. Tente novamente.' }); 
        }
        res.status(500).json({ message: 'Erro interno do servidor ao tentar cadastrar.' }); 
    }
});

// 7.2. Rota de Login (POST /api/auth/login)
authRouter.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email e senha são obrigatórios.' }); 
    }

    try {
        const user = await User.findOne({ email: email.toLowerCase() }); 
        if (!user) {
            return res.status(401).json({ message: 'Credenciais inválidas.' }); // Email não encontrado 
        }

        const isMatch = await bcrypt.compare(password, user.password); 
        if (!isMatch) {
            return res.status(401).json({ message: 'Credenciais inválidas.' }); // Senha incorreta 
        }

        if (user.isBlocked) {
            return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' }); 
        }

        user.lastLoginAt = new Date(); 
        await user.save(); 

        const token = generateToken(user._id, user.isAdmin); 

        res.json({
            message: 'Login bem-sucedido!', 
            token,
            user: {
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

// 7.3. Rota para Informação de Recuperação de Senha (POST /api/auth/request-password-recovery)
authRouter.post('/request-password-recovery', (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ message: "Email é obrigatório." }); 
    }
    // Apenas simula a verificação se o email existe para não vazar informações
    // Em um sistema real, você poderia querer logar essa tentativa.
    console.log(`Solicitação de recuperação de senha para: ${email}`); 
    res.status(200).json({
        message: "Para recuperar sua senha, por favor, entre em contato com o administrador da plataforma e forneça seu email e a resposta para sua pergunta de segurança. O administrador irá guiá-lo no processo." 
    });
});

app.use('/api/auth', authRouter);
// server.js
// ... (continuação da Parte 7: ROTAS DE AUTENTICAÇÃO)

// -----------------------------------------------------------------------------
// 8. ROTAS PÚBLICAS (Não requerem autenticação)
// -----------------------------------------------------------------------------
const publicRouter = express.Router();

// 8.1. Listar Planos de Investimento Ativos (GET /api/public/plans)
publicRouter.get('/plans', async (req, res) => {
    try {
        const plans = await Plan.find({ isActive: true }).sort({ order: 1, investmentAmount: 1 }); //
        res.json(plans.map(plan => ({
            id: plan._id, //
            name: plan.name, //
            investmentAmount: plan.investmentAmount, //
            dailyProfitRate: plan.dailyProfitRate, //
            dailyProfitAmount: plan.dailyProfitAmount, //
            claimValue: plan.claimValue, //
            claimsPerDay: plan.claimsPerDay, //
            description: plan.description,
            imageUrl: plan.imageUrl,
            tags: plan.tags,
            order: plan.order
        })));
    } catch (error) {
        console.error("Erro ao buscar planos:", error); //
        res.status(500).json({ message: "Erro ao buscar planos de investimento." }); //
    }
});

// 8.2. Buscar Configurações Públicas do Site (GET /api/public/site-settings)
publicRouter.get('/site-settings', async (req, res) => {
    try {
        const allSettings = await getSiteSettings(); // Usa a função utilitária com cache

        // Filtrar apenas as configurações que são seguras para serem públicas
        // As novas configurações de bônus (registrationBonusAmount, isRegistrationBonusActive)
        // NÃO devem ser expostas publicamente aqui.
        const publicSettings = {
            contactTextLogin: allSettings.contactTextLogin, //
            contactTextRegister: allSettings.contactTextRegister, //
            contactTextPanel: allSettings.contactTextPanel, //
            withdrawalFeeInfo: allSettings.withdrawalFeeInfo || "Taxa de manuseio varia de 2% a 15% dependendo do valor e método.", //
            maxWithdrawalAmount: allSettings.maxWithdrawalAmount || 50000, //
            minWithdrawalAmount: allSettings.minWithdrawalAmount || 50, //
            siteName: allSettings.siteName || "GoldMT Invest" //
            // Adicione outras chaves que devem ser públicas aqui, se necessário
        };
        res.json(publicSettings);
    } catch (error) {
        console.error("Erro ao buscar configurações públicas do site:", error); //
        res.status(500).json({ message: "Erro ao buscar configurações do site." }); //
    }
});

// 8.3. Rota para dados fictícios da página inicial (GET /api/public/fake-activity)
publicRouter.get('/fake-activity', (req, res) => {
    const activities = [
        { user: "Usuário A.", action: "depositou", amount: "750 MT", icon: "fa-arrow-down" }, //
        { user: "Investidor B.", action: "investiu no Plano Ouro", amount: "", icon: "fa-chart-line" }, //
        { user: "Cliente C.", action: "levantou", amount: "300 MT", icon: "fa-arrow-up" }, //
        { user: "Membro D.", action: "completou um claim de", amount: "79.70 MT", icon: "fa-check-circle" }, //
        { user: "Usuário E.", action: "registrou-se e ganhou", amount: "200 MT", icon: "fa-user-plus" }, // Este pode ser atualizado dinamicamente no frontend se desejado, mas aqui é só um exemplo estático
        { user: "Investidor F.", action: "depositou", amount: "15000 MT", icon: "fa-arrow-down" }, //
        { user: "Cliente G.", action: "convidou um amigo", amount: "", icon: "fa-users" }, //
    ];
    // Embaralha e retorna algumas atividades
    const shuffled = activities.sort(() => 0.5 - Math.random()); //
    res.json(shuffled.slice(0, Math.floor(Math.random() * 3) + 3)); // Retorna entre 3 e 5 atividades //
});

// 8.4. Listar Banners da Homepage Ativos (GET /api/public/homepage-banners)
publicRouter.get('/homepage-banners', async (req, res) => {
    try {
        const banners = await HomepageBanner.find({ isActive: true })
            .sort({ order: 1, createdAt: -1 });

        res.json(banners.map(banner => ({
            id: banner._id,
            title: banner.title,
            mediaType: banner.mediaType,
            mediaUrl: banner.mediaUrl,
            videoPlatform: banner.videoPlatform,
            textOverlay: banner.textOverlay,
            ctaText: banner.ctaText,
            ctaLink: banner.ctaLink,
            backgroundColor: banner.backgroundColor,
            textColor: banner.textColor
        })));
    } catch (error) {
        console.error("Erro ao buscar banners da homepage:", error);
        res.status(500).json({ message: "Erro ao buscar banners da homepage." });
    }
});

// 8.5. Rotas Públicas do Blog
const blogPublicRouter = express.Router();

// Listar Posts Publicados
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
            // Evitar regex no 'content' aqui por performance; usar $text se indexado
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
            if (tg) query.tags = tg._id;
            else return res.json({ posts: [], totalPages: 0, currentPage: parseInt(page), totalCount: 0 });
        }

        const posts = await BlogPost.find(query)
            .populate('category', 'name slug')
            .populate('tags', 'name slug')
            .populate('author', 'name')
            .sort({ isFeatured: -1, publishedAt: -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit))
            .select('title slug excerpt coverImage category tags author publishedAt isFeatured views'); // Omitir 'content' aqui

        const totalPosts = await BlogPost.countDocuments(query);

        const formattedPosts = posts.map(post => ({
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
            coverImage: post.coverImage,
            category: post.category ? { name: post.category.name, slug: post.category.slug } : null,
            tags: post.tags.map(t => ({ name: t.name, slug: t.slug })),
            author: post.author ? post.author.name : 'Autor Desconhecido',
            publishedAt: post.publishedAt,
            isFeatured: post.isFeatured,
            views: post.views
        }));

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

// Obter um Post Específico pelo Slug
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
        const publicPost = {
            title: post.title, slug: post.slug, content: post.content, excerpt: post.excerpt,
            coverImage: post.coverImage,
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

// Listar Todas as Categorias Públicas
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

// Listar Todas as Tags Públicas
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
// server.js
// ... (continuação da Parte 7: ROTAS DE AUTENTICAÇÃO, conforme seu arquivo original server (5).js)

// -----------------------------------------------------------------------------
// 9. ROTAS DO USUÁRIO AUTENTICADO
// -----------------------------------------------------------------------------
const userRouter = express.Router();
userRouter.use(authenticateToken); // Todas as rotas aqui são protegidas

// 9.1. Obter Dados do Painel do Usuário (GET /api/user/dashboard)
userRouter.get('/dashboard', async (req, res) => {
    try {
        const user = await User.findById(req.user.id)
            .select('-password -securityAnswer -securityQuestion') // Não enviar dados sensíveis
            .populate('activeInvestments.planId', 'name claimsPerDay') // Popula o nome e claimsPerDay do plano
            .populate('referredBy', 'name email'); // Apenas para info, se necessário

        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." }); //
        }

        const totalBalance = (user.balance.MT || 0) + (user.bonusBalance || 0) + (user.referralEarnings || 0); //

        const activeInvestmentsDetails = user.activeInvestments.map(inv => ({
            id: inv._id, //
            planName: inv.planName, //
            investedAmount: inv.investedAmount, //
            dailyProfitAmount: inv.dailyProfitAmount, //
            claimValue: inv.claimValue, //
            claimsMadeToday: inv.claimsMadeToday, //
            claimsPerDay: (inv.planId && inv.planId.claimsPerDay) || 5, // Pegar do plano original ou default
            activatedAt: inv.activatedAt, //
        }));

        const claimHistoryDetails = user.claimHistory
            .sort((a, b) => b.claimedAt - a.claimedAt) // Mais recentes primeiro
            .slice(0, 20) // Limitar a 20 por performance
            .map(claim => ({
                planName: claim.planName, //
                amount: claim.amount, //
                currency: claim.currency, //
                claimedAt: claim.claimedAt, //
                claimNumber: claim.claimNumber //
            }));
        
        const deposits = await Deposit.find({ userId: req.user.id })
            .sort({ requestedAt: -1 }) //
            .limit(10) //
            .select('amount method status requestedAt'); //

        const referralsMade = await ReferralHistory.find({ referrerId: req.user.id }); //
        const successfulReferrals = referralsMade.filter(r => r.status === 'Confirmado').length; //

        const now = new Date();
        // Fetching user-specific and global notifications is now handled by /api/user/notifications
        // We can fetch a count of unread notifications here for the dashboard badge.
        const relevantNotificationsForUser = await Notification.find({
            isActive: true,
            $or: [ { targetAudience: 'all' }, { targetAudience: 'specificUser', targetUserId: user._id } ],
            $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } } ]
        }).select('_id');
        const relevantNotificationIdsForUser = relevantNotificationsForUser.map(n => n._id);

        let unreadNotificationCount = 0;
        if (relevantNotificationIdsForUser.length > 0) {
            unreadNotificationCount = await UserNotificationStatus.countDocuments({
                userId: user._id,
                notificationId: { $in: relevantNotificationIdsForUser },
                isRead: false,
                isDeleted: false
            });
        }
        
        res.json({
            name: user.name, //
            email: user.email, //
            referralCode: `${FRONTEND_URL}/register.html?ref=${user.referralCode}`, //
            totalBalance: parseFloat(totalBalance.toFixed(2)), //
            mainBalanceMT: parseFloat((user.balance.MT || 0).toFixed(2)), //
            bonusBalance: parseFloat((user.bonusBalance || 0).toFixed(2)), // O valor do bônus já estará aqui conforme definido no registro
            referralEarningsBalance: parseFloat((user.referralEarnings || 0).toFixed(2)), //
            activeInvestments: activeInvestmentsDetails, //
            claimHistory: claimHistoryDetails, //
            deposits: deposits, //
            referrals: {
                count: referralsMade.length, //
                successfulCount: successfulReferrals, //
                totalEarned: parseFloat((user.referralEarnings || 0).toFixed(2)), //
                link: `${FRONTEND_URL}/register.html?ref=${user.referralCode}` //
            },
            unreadNotificationCount: unreadNotificationCount, // Para o badge do sino
            firstDepositMade: user.firstDepositMade, //
            isBlocked: user.isBlocked //
        });

    } catch (error) {
        console.error("Erro ao buscar dados do dashboard:", error); //
        res.status(500).json({ message: "Erro ao buscar dados do painel." }); //
    }
});

// 9.2. Solicitar Depósito (POST /api/user/deposits)
userRouter.post('/deposits', async (req, res) => {
    const { amount, method, transactionIdOrConfirmationMessage, paymentDetailsUsed /*, planId */ } = req.body; // planId é opcional e não está sendo usado para ativar plano diretamente aqui

    if (!amount || !method || !transactionIdOrConfirmationMessage || !paymentDetailsUsed) {
        return res.status(400).json({ message: "Valor, método, mensagem de confirmação e detalhes do pagamento são obrigatórios." }); //
    }
    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        return res.status(400).json({ message: "Valor do depósito inválido." }); //
    }

    try {
        const user = await User.findById(req.user.id); //
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." }); //

        const siteConfig = await getSiteSettings(); //
        const activePaymentMethods = siteConfig.paymentMethods || []; //
        const chosenMethodConfig = activePaymentMethods.find(pm => pm.name === method && pm.isActive); //

        if (!chosenMethodConfig) {
            return res.status(400).json({ message: `Método de pagamento '${method}' não está ativo ou não existe.` }); //
        }
        
        const deposit = new Deposit({
            userId: req.user.id, //
            amount: parseFloat(amount), //
            method, //
            transactionIdOrConfirmationMessage, //
            paymentDetailsUsed, // O número/carteira que o admin configurou e o usuário usou
            status: 'Pendente' //
        });
        await deposit.save(); //

        res.status(201).json({ message: "Solicitação de depósito recebida. Aguardando confirmação do administrador.", deposit }); //

    } catch (error) {
        console.error("Erro ao solicitar depósito:", error); //
        res.status(500).json({ message: "Erro ao processar solicitação de depósito." }); //
    }
});

// 9.3. Listar Depósitos do Usuário (GET /api/user/deposits)
userRouter.get('/deposits', async (req, res) => {
    try {
        const deposits = await Deposit.find({ userId: req.user.id }).sort({ requestedAt: -1 }); //
        res.json(deposits);
    } catch (error) {
        console.error("Erro ao buscar depósitos:", error); //
        res.status(500).json({ message: "Erro ao buscar histórico de depósitos." }); //
    }
});

// 9.4. Obter Métodos de Depósito Ativos (GET /api/user/deposit-methods)
userRouter.get('/deposit-methods', async (req, res) => {
    try {
        const siteConfig = await getSiteSettings(); //
        const paymentMethods = (siteConfig.paymentMethods || [])
            .filter(pm => pm.isActive) //
            .map(pm => ({ name: pm.name, details: pm.details, instructions: pm.instructions, type: pm.type })); //
        res.json(paymentMethods);
    } catch (error) {
        console.error("Erro ao buscar métodos de depósito:", error); //
        res.status(500).json({ message: "Erro ao buscar métodos de depósito." }); //
    }
});

// 9.5. Realizar Claim (POST /api/user/claims)
userRouter.post('/claims', async (req, res) => {
    const { investmentId, currencyForClaim } = req.body; // investmentId é o _id do subdocumento activeInvestments

    if (!investmentId || !currencyForClaim) {
        return res.status(400).json({ message: "ID do investimento e moeda do claim são obrigatórios." }); //
    }

    const siteConfig = await getSiteSettings();
    const allowedClaimCurrencies = siteConfig.allowedClaimCurrencies || ["MT", "BTC", "ETH", "USDT"]; 
    if (!allowedClaimCurrencies.includes(currencyForClaim.toUpperCase())) {
        return res.status(400).json({ message: `Moeda de claim '${currencyForClaim}' não é permitida.` }); //
    }

    try {
        const user = await User.findById(req.user.id).populate('activeInvestments.planId'); //
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." }); //

        const investment = user.activeInvestments.id(investmentId); //
        if (!investment) {
            return res.status(404).json({ message: "Investimento ativo não encontrado." }); //
        }
        if (!investment.planId) { // Checagem de segurança //
            return res.status(500).json({ message: "Dados do plano associado ao investimento corrompidos."}); //
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0); //
        if (investment.lastClaimDate && investment.lastClaimDate < today) {
            investment.claimsMadeToday = 0; //
        }

        const maxClaimsPerDay = investment.planId.claimsPerDay || 5;
        if (investment.claimsMadeToday >= maxClaimsPerDay ) {
            return res.status(400).json({ message: "Você já realizou o número máximo de claims para este investimento hoje." }); //
        }

        const claimAmountMT = investment.claimValue; // Valor do claim é sempre em MT (referência) //

        user.balance.MT = (user.balance.MT || 0) + claimAmountMT; //

        investment.claimsMadeToday += 1; //
        investment.lastClaimDate = new Date(); //

        const newClaimRecord = {
            planId: investment.planId._id, //
            planName: investment.planName, //
            claimNumber: investment.claimsMadeToday, //
            amount: claimAmountMT, //
            currency: currencyForClaim.toUpperCase(), // Moeda que o usuário "escolheu" para representar esse claim
            claimedAt: new Date() //
        };
        user.claimHistory.push(newClaimRecord); //

        await user.save(); //

        res.json({
            message: `Claim de ${claimAmountMT.toFixed(2)} MT (representado como ${currencyForClaim.toUpperCase()}) realizado com sucesso!`, //
            claim: newClaimRecord, //
            updatedBalanceMT: user.balance.MT, //
            claimsMadeToday: investment.claimsMadeToday, //
        });

    } catch (error) {
        console.error("Erro ao realizar claim:", error); //
        res.status(500).json({ message: "Erro ao processar claim." }); //
    }
});


// 9.6. Listar Histórico de Claims do Usuário (GET /api/user/claims)
userRouter.get('/claims', async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('claimHistory').lean(); // .lean() para objeto JS puro
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." }); //

        const claimHistory = (user.claimHistory || [])
            .sort((a, b) => new Date(b.claimedAt) - new Date(a.claimedAt)); // Mais recentes primeiro

        res.json(claimHistory);
    } catch (error) {
        console.error("Erro ao buscar histórico de claims:", error); //
        res.status(500).json({ message: "Erro ao buscar histórico de claims." }); //
    }
});

// 9.7. Solicitar Saque (POST /api/user/withdrawals)
userRouter.post('/withdrawals', async (req, res) => {
    const { amount, withdrawalMethod, recipientInfo } = req.body;

    if (!amount || !withdrawalMethod || !recipientInfo) {
        return res.status(400).json({ message: "Valor, método de saque e informações do destinatário são obrigatórios." }); //
    }

    const withdrawalAmount = parseFloat(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
        return res.status(400).json({ message: "Valor de saque inválido." }); //
    }
    
    const siteConfig = await getSiteSettings();
    const MIN_WITHDRAWAL = siteConfig.minWithdrawalAmount || 50; //
    const MAX_WITHDRAWAL = siteConfig.maxWithdrawalAmount || 50000; //

    if (withdrawalAmount < MIN_WITHDRAWAL) {
        return res.status(400).json({ message: `O valor mínimo para saque é de ${MIN_WITHDRAWAL} MT.` }); //
    }
    if (withdrawalAmount > MAX_WITHDRAWAL) {
        return res.status(400).json({ message: `O valor máximo para saque é de ${MAX_WITHDRAWAL} MT.` }); //
    }

    try {
        const user = await User.findById(req.user.id); //
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." }); //

        if (!user.firstDepositMade) {
            return res.status(403).json({ message: "Você precisa realizar pelo menos um depósito confirmado para solicitar saques. Saldos de bônus e referências serão liberados após o primeiro depósito." }); //
        }

        let feePercentage = parseFloat(siteConfig.withdrawalFeePercentageBase) || 0.02; // 2% base
        const highValueThreshold1 = parseFloat(siteConfig.withdrawalFeeHighValueThreshold1) || 10000;
        const highValueFee1 = parseFloat(siteConfig.withdrawalFeeHighValuePercentage1) || 0.05;
        const highValueThreshold2 = parseFloat(siteConfig.withdrawalFeeHighValueThreshold2) || 25000;
        const highValueFee2 = parseFloat(siteConfig.withdrawalFeeHighValuePercentage2) || 0.10;
        const cryptoFeeBonus = parseFloat(siteConfig.withdrawalFeeCryptoBonus) || 0.02;
        const maxFee = parseFloat(siteConfig.withdrawalFeeMaxPercentage) || 0.15;


        if (withdrawalAmount > highValueThreshold1) feePercentage = highValueFee1; //
        if (withdrawalAmount > highValueThreshold2) feePercentage = highValueFee2; //
        if (withdrawalMethod.toLowerCase().includes('btc') || withdrawalMethod.toLowerCase().includes('eth')) { // Deveria ser || ETH || USDT
            feePercentage += cryptoFeeBonus; //
        }
        feePercentage = Math.min(feePercentage, maxFee); //

        const feeApplied = parseFloat((withdrawalAmount * feePercentage).toFixed(2)); //
        const netAmount = parseFloat((withdrawalAmount - feeApplied).toFixed(2)); //

        const availableBalanceForWithdrawal = (user.balance.MT || 0) + (user.bonusBalance || 0) + (user.referralEarnings || 0); //

        if (withdrawalAmount > availableBalanceForWithdrawal) {
            return res.status(400).json({ message: `Saldo insuficiente para este saque. Saldo disponível para saque: ${availableBalanceForWithdrawal.toFixed(2)} MT.` }); //
        }

        let amountToDeduct = withdrawalAmount; //
        
        const mainBalanceDeduction = Math.min(amountToDeduct, user.balance.MT || 0); //
        user.balance.MT -= mainBalanceDeduction; //
        amountToDeduct -= mainBalanceDeduction; //

        if (amountToDeduct > 0) {
            const bonusBalanceDeduction = Math.min(amountToDeduct, user.bonusBalance || 0); //
            user.bonusBalance -= bonusBalanceDeduction; //
            amountToDeduct -= bonusBalanceDeduction; //
        }

        if (amountToDeduct > 0) {
            const referralEarningsDeduction = Math.min(amountToDeduct, user.referralEarnings || 0); //
            user.referralEarnings -= referralEarningsDeduction; //
        }
        
        await user.save(); //

        const withdrawal = new Withdrawal({
            userId: req.user.id, //
            amount: withdrawalAmount, //
            withdrawalMethod, //
            recipientInfo, //
            feeApplied, //
            netAmount, //
            status: 'Pendente' //
        });
        await withdrawal.save(); //

        res.status(201).json({
            message: `Solicitação de saque de ${withdrawalAmount.toFixed(2)} MT enviada. Taxa: ${feeApplied.toFixed(2)} MT. Valor líquido: ${netAmount.toFixed(2)} MT. Aguardando processamento.`, //
            withdrawal //
        });

    } catch (error) {
        console.error("Erro ao solicitar saque:", error); //
        res.status(500).json({ message: "Erro ao processar solicitação de saque." }); //
    }
});

// 9.8. Listar Saques do Usuário (GET /api/user/withdrawals)
userRouter.get('/withdrawals', async (req, res) => {
    try {
        const withdrawals = await Withdrawal.find({ userId: req.user.id }).sort({ requestedAt: -1 }); //
        res.json(withdrawals);
    } catch (error) {
        console.error("Erro ao buscar saques:", error); //
        res.status(500).json({ message: "Erro ao buscar histórico de saques." }); //
    }
});

// 9.9. Informações de Referência do Usuário (GET /api/user/referrals)
userRouter.get('/referrals', async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('referralCode referralEarnings'); //
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." }); //

        const referrals = await ReferralHistory.find({ referrerId: req.user.id })
            .populate('referredId', 'name email createdAt') // Popula dados do indicado
            .sort({ earnedAt: -1, _id: -1 }); //

        res.json({
            referralLink: `${FRONTEND_URL}/register.html?ref=${user.referralCode}`, //
            totalEarned: user.referralEarnings || 0, //
            referralsList: referrals.map(r => ({
                referredUserName: r.referredId ? r.referredId.name : 'Usuário Deletado', //
                referredUserEmail: r.referredId ? r.referredId.email : '-', //
                status: r.status, //
                bonusAmount: r.bonusAmount, //
                earnedAt: r.status === 'Confirmado' ? r.earnedAt : null, //
                registeredAt: r.referredId ? r.referredId.createdAt : null, //
            }))
        });
    } catch (error) {
        console.error("Erro ao buscar dados de referência:", error); //
        res.status(500).json({ message: "Erro ao buscar dados de referência." }); //
    }
});

// 9.10. Listar Promoções Urgentes Ativas para o Usuário (GET /api/user/urgent-promotions)
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
            image: promo.image,
            description: promo.description,
            expiresAt: promo.expiresAt,
            link: promo.link,
            badgeText: promo.badgeText,
        })));
    } catch (error) {
        console.error("Erro ao buscar promoções urgentes para o usuário:", error);
        res.status(500).json({ message: "Erro ao buscar promoções urgentes." });
    }
});

// 9.11. Listar Notificações do Usuário (GET /api/user/notifications)
userRouter.get('/notifications', async (req, res) => {
    const userId = req.user.id;
    const { page = 1, limit = 10, status = 'all' } = req.query; // status: 'all', 'read', 'unread'

    try {
        const now = new Date();
        const relevantNotifications = await Notification.find({
            isActive: true,
            $or: [ { targetAudience: 'all' }, { targetAudience: 'specificUser', targetUserId: userId } ],
            $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } } ]
        }).select('_id');
        const relevantNotificationIds = relevantNotifications.map(n => n._id);

        if (relevantNotificationIds.length === 0) {
            return res.json({ notifications: [], totalPages: 0, currentPage: parseInt(page), unreadCount: 0, totalCount: 0 });
        }
        
        const userNotificationStatuses = await UserNotificationStatus.find({
            userId: userId,
            notificationId: { $in: relevantNotificationIds },
            isDeleted: false
        });

        const existingStatusMap = new Map(userNotificationStatuses.map(s => [s.notificationId.toString(), s]));
        const newStatusesToCreate = [];

        for (const notificationId of relevantNotificationIds) {
            if (!existingStatusMap.has(notificationId.toString())) {
                newStatusesToCreate.push({ userId: userId, notificationId: notificationId, isRead: false, isDeleted: false });
            }
        }
        if (newStatusesToCreate.length > 0) {
            await UserNotificationStatus.insertMany(newStatusesToCreate, { ordered: false }).catch(err => {
                if (err.code !== 11000) { console.warn("Erro ao inserir novos status de notificação:", err.message); }
            });
        }
        
        let queryOptions = { userId: userId, notificationId: { $in: relevantNotificationIds }, isDeleted: false };
        if (status === 'read') queryOptions.isRead = true;
        else if (status === 'unread') queryOptions.isRead = false;

        const totalUserNotifications = await UserNotificationStatus.countDocuments(queryOptions);
        const userStatuses = await UserNotificationStatus.find(queryOptions)
            .populate({ path: 'notificationId', model: 'Notification', select: 'title message type createdAt expiresAt link' })
            .sort({ 'notificationId.createdAt': -1 })
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));
            
        const unreadCount = await UserNotificationStatus.countDocuments({
            userId: userId, notificationId: { $in: relevantNotificationIds }, isRead: false, isDeleted: false
        });
        
        res.json({
            notifications: userStatuses.map(us => ({
                userNotificationId: us._id, id: us.notificationId._id, title: us.notificationId.title,
                message: us.notificationId.message, type: us.notificationId.type, link: us.notificationId.link,
                createdAt: us.notificationId.createdAt, expiresAt: us.notificationId.expiresAt,
                isRead: us.isRead, readAt: us.readAt
            })),
            totalPages: Math.ceil(totalUserNotifications / limit), currentPage: parseInt(page),
            unreadCount: unreadCount, totalCount: totalUserNotifications
        });
    } catch (error) {
        console.error("Erro ao listar notificações do usuário:", error);
        res.status(500).json({ message: "Erro ao buscar notificações.", error: error.message });
    }
});
// 9.12. Marcar Notificações como Lidas (POST /api/user/notifications/mark-as-read)
userRouter.post('/notifications/mark-as-read', async (req, res) => {
    const userId = req.user.id;
    const { notificationStatusIds, markAllAsRead = false } = req.body;

    if (!markAllAsRead && (!Array.isArray(notificationStatusIds) || notificationStatusIds.length === 0)) {
        return res.status(400).json({ message: "Forneça IDs de notificação ou marque todas como lidas." });
    }
    try {
        let updateQuery = { userId: userId, isRead: false, isDeleted: false };
        if (!markAllAsRead) updateQuery._id = { $in: notificationStatusIds };

        const result = await UserNotificationStatus.updateMany(updateQuery, { $set: { isRead: true, readAt: new Date() } });

        if (result.nModified === 0 && !markAllAsRead && notificationStatusIds && notificationStatusIds.length > 0) {
            const count = await UserNotificationStatus.countDocuments({ userId: userId, _id: { $in: notificationStatusIds }});
            if (count === 0) return res.status(404).json({ message: "Nenhuma notificação encontrada para os IDs fornecidos." });
        }
        
        const relevantNotifications = await Notification.find({
            isActive: true, $or: [ { targetAudience: 'all' }, { targetAudience: 'specificUser', targetUserId: userId } ],
            $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } } ]
        }).select('_id');
        const relevantNotificationIds = relevantNotifications.map(n => n._id);
        const unreadCount = relevantNotificationIds.length > 0 ? await UserNotificationStatus.countDocuments({
            userId: userId, notificationId: { $in: relevantNotificationIds }, isRead: false, isDeleted: false
        }) : 0;

        res.json({ message: `${result.nModified} notificação(ões) marcada(s) como lida(s).`, modifiedCount: result.nModified, unreadCount: unreadCount });
    } catch (error) {
        console.error("Erro ao marcar notificações como lidas:", error);
        res.status(500).json({ message: "Erro ao atualizar notificações.", error: error.message });
    }
});
// 9.13. Deletar Notificação do Usuário (Soft Delete) (POST /api/user/notifications/delete)
userRouter.post('/notifications/delete', async (req, res) => {
    const userId = req.user.id;
    const { notificationStatusIds, deleteAll = false } = req.body;

    if (!deleteAll && (!Array.isArray(notificationStatusIds) || notificationStatusIds.length === 0)) {
        return res.status(400).json({ message: "Forneça IDs de notificação para deletar ou marque para deletar todas." });
    }
    try {
        let updateQuery = { userId: userId, isDeleted: false };
        if (!deleteAll) updateQuery._id = { $in: notificationStatusIds };

        const result = await UserNotificationStatus.updateMany(updateQuery, { $set: { isDeleted: true, deletedAt: new Date(), isRead: true, readAt: new Date() } });

        if (result.nModified === 0 && !deleteAll && notificationStatusIds && notificationStatusIds.length > 0) {
            const count = await UserNotificationStatus.countDocuments({ userId: userId, _id: { $in: notificationStatusIds }});
            if (count === 0) return res.status(404).json({ message: "Nenhuma notificação encontrada para os IDs fornecidos para deleção." });
        }
        
        const relevantNotifications = await Notification.find({
            isActive: true, $or: [ { targetAudience: 'all' }, { targetAudience: 'specificUser', targetUserId: userId } ],
            $or: [ { expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: new Date() } } ]
        }).select('_id');
        const relevantNotificationIds = relevantNotifications.map(n => n._id);
        const unreadCount = relevantNotificationIds.length > 0 ? await UserNotificationStatus.countDocuments({
            userId: userId, notificationId: { $in: relevantNotificationIds }, isRead: false, isDeleted: false
        }) : 0;

        res.json({ message: `${result.nModified} notificação(ões) marcada(s) como deletada(s).`, modifiedCount: result.nModified, unreadCount: unreadCount });
    } catch (error) {
        console.error("Erro ao deletar notificações do usuário:", error);
        res.status(500).json({ message: "Erro ao deletar notificações.", error: error.message });
    }
});

app.use('/api/user', userRouter); 
// server.js
// ... (continuação da Parte 9: ROTAS DO USUÁRIO AUTENTICADO)

// -----------------------------------------------------------------------------
// 10. ROTAS DO ADMINISTRADOR
// -----------------------------------------------------------------------------
const adminRouter = express.Router();
adminRouter.use(authenticateToken, authorizeAdmin); // Todas as rotas aqui são protegidas e para admin

// 10.1. Gerenciamento de Depósitos
// 10.1.1. Listar todos os depósitos (com filtros) (GET /api/admin/deposits)
adminRouter.get('/deposits', async (req, res) => {
    const { status, userId, page = 1, limit = 10 } = req.query; //
    const query = {};
    if (status) query.status = status; //
    if (userId) query.userId = userId; //

    try {
        const deposits = await Deposit.find(query)
            .populate('userId', 'name email') // Adiciona nome e email do usuário
            .sort({ requestedAt: -1 }) //
            .skip((parseInt(page) - 1) * parseInt(limit)) //
            .limit(parseInt(limit)); //

        const totalDeposits = await Deposit.countDocuments(query); //

        res.json({
            deposits, //
            totalPages: Math.ceil(totalDeposits / limit), //
            currentPage: parseInt(page), //
            totalCount: totalDeposits //
        });
    } catch (error) {
        console.error("Admin - Erro ao listar depósitos:", error); //
        res.status(500).json({ message: "Erro ao listar depósitos." }); //
    }
});

// 10.1.2. Aprovar ou Rejeitar Depósito (PATCH /api/admin/deposits/:depositId)
adminRouter.patch('/deposits/:depositId', async (req, res) => {
    const { depositId } = req.params; //
    const { status, adminNotes, targetPlanId } = req.body; // status deve ser 'Confirmado' ou 'Rejeitado'

    if (!['Confirmado', 'Rejeitado'].includes(status)) {
        return res.status(400).json({ message: "Status inválido. Use 'Confirmado' ou 'Rejeitado'." }); //
    }

    try {
        const deposit = await Deposit.findById(depositId); //
        if (!deposit) {
            return res.status(404).json({ message: "Depósito não encontrado." }); //
        }
        if (deposit.status !== 'Pendente') {
            return res.status(400).json({ message: `Este depósito já foi ${deposit.status.toLowerCase()}.` }); //
        }

        const user = await User.findById(deposit.userId); //
        if (!user) {
            return res.status(404).json({ message: "Usuário associado ao depósito não encontrado." }); //
        }

        deposit.status = status; //
        deposit.processedAt = new Date(); //
        if (adminNotes) deposit.adminNotes = adminNotes; //

        if (status === 'Confirmado') {
            user.balance.MT = (user.balance.MT || 0) + deposit.amount; //

            if (!user.firstDepositMade) {
                user.firstDepositMade = true; //
                const referralRecord = await ReferralHistory.findOne({ referredId: user._id, status: 'Pendente' }); //
                if (referralRecord) {
                    const referrer = await User.findById(referralRecord.referrerId); //
                    if (referrer) {
                        referrer.referralEarnings = (referrer.referralEarnings || 0) + referralRecord.bonusAmount; //
                        referralRecord.status = 'Confirmado'; //
                        referralRecord.earnedAt = new Date(); //
                        await referrer.save(); //
                        await referralRecord.save(); //
                        console.log(`Bônus de referência de ${referralRecord.bonusAmount} MT creditado para ${referrer.email}`); //
                    }
                }
            }

            if (targetPlanId) { //
                 const planToActivate = await Plan.findById(targetPlanId); //
                 if (planToActivate && planToActivate.isActive && deposit.amount >= planToActivate.investmentAmount) { //
                    // Se o plano consome o depósito, subtrair do saldo (já foi adicionado)
                    // user.balance.MT -= planToActivate.investmentAmount; // Esta linha foi comentada no original, mantendo assim.

                    const newInvestment = {
                        planId: planToActivate._id, //
                        planName: planToActivate.name, //
                        investedAmount: planToActivate.investmentAmount, //
                        dailyProfitRate: planToActivate.dailyProfitRate, //
                        dailyProfitAmount: planToActivate.dailyProfitAmount, //
                        claimValue: planToActivate.claimValue, //
                        claimsMadeToday: 0, //
                        activatedAt: new Date(), //
                    };
                    user.activeInvestments.push(newInvestment); //
                    console.log(`Plano ${planToActivate.name} ativado para ${user.email} com depósito de ${deposit.amount} MT.`); //
                 } else {
                    console.warn(`Admin: Plano ${targetPlanId} não encontrado, inativo ou valor do depósito insuficiente para ativação. Depósito apenas aumentou o saldo.`); //
                 }
            }
            await user.save(); //
        }
        await deposit.save(); //
        res.json({ message: `Depósito ${status.toLowerCase()} com sucesso.`, deposit }); //

    } catch (error) {
        console.error(`Admin - Erro ao ${status === 'Confirmado' ? 'aprovar' : 'rejeitar'} depósito:`, error); //
        res.status(500).json({ message: "Erro ao processar o depósito." }); //
    }
});

// 10.2. Gerenciamento de Métodos de Pagamento (AdminSetting)
// 10.2.1. Listar métodos de pagamento (GET /api/admin/payment-methods)
adminRouter.get('/payment-methods', async (req, res) => {
    try {
        const setting = await AdminSetting.findOne({ key: 'paymentMethods' }); //
        const methods = setting && setting.value ? setting.value : []; //
        res.json(methods);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar métodos de pagamento.', error: error.message }); //
    }
});

// 10.2.2. Adicionar/Atualizar método de pagamento (POST /api/admin/payment-methods)
adminRouter.post('/payment-methods', async (req, res) => {
    const { methods } = req.body; // Espera um array de objetos paymentMethodSchema
    if (!Array.isArray(methods)) {
        return res.status(400).json({ message: 'Formato inválido. "methods" deve ser um array.' }); //
    }
    for (const method of methods) {
        if (!method.name || !method.details || !method.type) { //
            return res.status(400).json({ message: 'Cada método deve ter nome, detalhes e tipo (fiat/crypto).' }); //
        }
         if (!['fiat', 'crypto'].includes(method.type)) {
            return res.status(400).json({ message: `Tipo de método inválido: ${method.type}. Use 'fiat' ou 'crypto'.`});
        }
    }

    try {
        await AdminSetting.findOneAndUpdate(
            { key: 'paymentMethods' }, //
            { key: 'paymentMethods', value: methods, description: 'Lista de métodos de pagamento para depósito.' }, //
            { upsert: true, new: true, runValidators: true } // Adicionado runValidators
        );
        siteSettingsCache = null; // Invalidar cache
        await getSiteSettings(); // Recarregar cache
        res.json({ message: 'Métodos de pagamento atualizados com sucesso.', methods }); //
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar métodos de pagamento.', error: error.message }); //
    }
});

// 10.3. Gerenciamento de Planos de Investimento
// 10.3.1. Listar todos os planos (GET /api/admin/plans)
adminRouter.get('/plans', async (req, res) => {
    try {
        const plans = await Plan.find({}).sort({ order: 1, investmentAmount: 1 }); //
        res.json(plans);
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar planos." }); //
    }
});

// 10.3.2. Criar Plano (POST /api/admin/plans)
adminRouter.post('/plans', async (req, res) => {
    const {
        name, investmentAmount, dailyProfitRate, dailyProfitAmount, claimValue,
        claimsPerDay = 5, isActive = true, order = 0,
        description, imageUrl, tags
    } = req.body;
    try {
        const newPlan = new Plan({
            name, investmentAmount, dailyProfitRate, dailyProfitAmount, claimValue,
            claimsPerDay, isActive, order,
            description, imageUrl, tags
        });
        await newPlan.save();
        res.status(201).json({ message: "Plano criado com sucesso.", plan: newPlan }); //
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ message: "Erro: Já existe um plano com este nome ou valor de investimento.", details: error.keyValue }); //
        }
        console.error("Admin - Erro ao criar plano:", error); //
        res.status(500).json({ message: "Erro ao criar plano." }); //
    }
});

// 10.3.3. Editar Plano (PUT /api/admin/plans/:planId)
adminRouter.put('/plans/:planId', async (req, res) => {
    const { planId } = req.params; //
    const {
        name, investmentAmount, dailyProfitRate, dailyProfitAmount, claimValue,
        claimsPerDay, isActive, order,
        description, imageUrl, tags
    } = req.body;
    try {
        const plan = await Plan.findByIdAndUpdate(planId,
            {
                name, investmentAmount, dailyProfitRate, dailyProfitAmount, claimValue,
                claimsPerDay, isActive, order,
                description, imageUrl, tags
            },
            { new: true, runValidators: true } //
        );
        if (!plan) return res.status(404).json({ message: "Plano não encontrado." }); //
        res.json({ message: "Plano atualizado com sucesso.", plan }); //
    } catch (error) {
        if (error.code === 11000) { //
            return res.status(409).json({ message: "Erro: Já existe outro plano com este nome ou valor de investimento.", details: error.keyValue }); //
        }
        console.error("Admin - Erro ao atualizar plano:", error); //
        res.status(500).json({ message: "Erro ao atualizar plano." }); //
    }
});

// 10.3.4. Deletar Plano (DELETE /api/admin/plans/:planId)
adminRouter.delete('/plans/:planId', async (req, res) => {
    const { planId } = req.params; //
    try {
        const usersWithPlan = await User.countDocuments({ "activeInvestments.planId": planId }); //
        if (usersWithPlan > 0) {
            return res.status(400).json({ message: `Não é possível deletar o plano. Ele está ativo para ${usersWithPlan} usuário(s). Considere desativá-lo.` }); //
        }
        const plan = await Plan.findByIdAndDelete(planId); //
        if (!plan) return res.status(404).json({ message: "Plano não encontrado." }); //
        res.json({ message: "Plano deletado com sucesso." }); //
    } catch (error) {
        console.error("Admin - Erro ao deletar plano:", error); //
        res.status(500).json({ message: "Erro ao deletar plano." }); //
    }
});

// 10.4. Gerenciamento de Usuários
// 10.4.1. Listar usuários (GET /api/admin/users)
adminRouter.get('/users', async (req, res) => {
    const { page = 1, limit = 10, search = '', isBlocked } = req.query; //
    const query = {};
    if (search) {
        query.$or = [
            { name: { $regex: search, $options: 'i' } }, //
            { email: { $regex: search, $options: 'i' } }, //
            { referralCode: { $regex: search, $options: 'i' } } //
        ];
    }
    if (typeof isBlocked !== 'undefined' && (isBlocked === 'true' || isBlocked === 'false')) {
        query.isBlocked = isBlocked === 'true'; //
    }

    try {
        const users = await User.find(query)
            .select('-password -securityAnswer -securityQuestion -claimHistory') // Excluir campos sensíveis/grandes
            .populate('referredBy', 'name email') //
            .sort({ createdAt: -1 }) //
            .skip((parseInt(page) - 1) * parseInt(limit)) //
            .limit(parseInt(limit)); //

        const totalUsers = await User.countDocuments(query); //
        res.json({
            users, //
            totalPages: Math.ceil(totalUsers / limit), //
            currentPage: parseInt(page), //
            totalCount: totalUsers //
        });
    } catch (error) {
        console.error("Admin - Erro ao listar usuários:", error); //
        res.status(500).json({ message: "Erro ao listar usuários." }); //
    }
});

// 10.4.2. Ver detalhes de um usuário (GET /api/admin/users/:userId)
adminRouter.get('/users/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .select('-password -securityAnswer') // Deixa a securityQuestion para o admin poder perguntar
            .populate('activeInvestments.planId', 'name investmentAmount') //
            .populate({ path: 'referredBy', select: 'name email' }) //
            .populate({ path: 'claimHistory', options: { sort: { claimedAt: -1 }, limit: 20 } }); // Limita histórico de claims

        if (!user) return res.status(404).json({ message: "Usuário não encontrado." }); //

        const deposits = await Deposit.find({ userId: user._id }).sort({ requestedAt: -1 }).limit(10); //
        const withdrawals = await Withdrawal.find({ userId: user._id }).sort({ requestedAt: -1 }).limit(10); //
        const referrals = await ReferralHistory.find({ referrerId: user._id }).populate('referredId', 'name email'); //

        res.json({ user, deposits, withdrawals, referrals }); //
    } catch (error) {
        console.error("Admin - Erro ao buscar detalhes do usuário:", error); //
        res.status(500).json({ message: "Erro ao buscar detalhes do usuário." }); //
    }
});

// 10.4.3. Bloquear/Desbloquear Usuário (PATCH /api/admin/users/:userId/block)
adminRouter.patch('/users/:userId/block', async (req, res) => {
    const { block } = req.body; // true para bloquear, false para desbloquear
    if (typeof block !== 'boolean') {
        return res.status(400).json({ message: "O status de bloqueio (block) deve ser true ou false." }); //
    }
    try {
        const user = await User.findByIdAndUpdate(req.params.userId, { isBlocked: block }, { new: true })
            .select('name email isBlocked'); //
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." }); //
        res.json({ message: `Usuário ${user.name} ${block ? 'bloqueado' : 'desbloqueado'} com sucesso.`, user }); //
    } catch (error) {
        console.error("Admin - Erro ao bloquear/desbloquear usuário:", error); //
        res.status(500).json({ message: "Erro ao atualizar status de bloqueio do usuário." }); //
    }
});

// 10.4.4. Forçar Atribuição de Plano para Usuário (POST /api/admin/users/:userId/assign-plan)
adminRouter.post('/users/:userId/assign-plan', async (req, res) => {
    const { userId } = req.params; //
    const { planId } = req.body; //

    if (!planId) {
        return res.status(400).json({ message: "ID do plano (planId) é obrigatório." }); //
    }

    try {
        const user = await User.findById(userId); //
        if (!user) return res.status(404).json({ message: "Usuário não encontrado." }); //

        const planToAssign = await Plan.findById(planId); //
        if (!planToAssign || !planToAssign.isActive) {
            return res.status(404).json({ message: "Plano não encontrado ou está inativo." }); //
        }

        const newInvestment = {
            planId: planToAssign._id, //
            planName: planToAssign.name, //
            investedAmount: planToAssign.investmentAmount, //
            dailyProfitRate: planToAssign.dailyProfitRate, //
            dailyProfitAmount: planToAssign.dailyProfitAmount, //
            claimValue: planToAssign.claimValue, //
            claimsMadeToday: 0, //
            activatedAt: new Date(), //
        };
        user.activeInvestments.push(newInvestment); //
        await user.save(); //

        res.json({ message: `Plano ${planToAssign.name} atribuído com sucesso ao usuário ${user.name}.`, investment: newInvestment }); //

    } catch (error) {
        console.error("Admin - Erro ao atribuir plano:", error); //
        res.status(500).json({ message: "Erro ao atribuir plano ao usuário." }); //
    }
});

// 10.4.5. (Admin) Recuperar conta do usuário (verificando pergunta de segurança)
adminRouter.post('/users/:userId/verify-security-answer', async (req, res) => {
    const { userId } = req.params; //
    const { answer } = req.body; //

    if (!answer) {
        return res.status(400).json({ message: "Resposta de segurança é obrigatória." }); //
    }

    try {
        const user = await User.findById(userId).select('+securityAnswer +securityQuestion'); // precisa buscar a resposta hasheada
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." }); //
        }
        if (!user.securityAnswer || !user.securityQuestion) {
            return res.status(400).json({ message: "Usuário não configurou pergunta/resposta de segurança." }); //
        }

        const isMatch = await bcrypt.compare(answer, user.securityAnswer); //
        if (!isMatch) {
            return res.status(400).json({ message: "Resposta de segurança incorreta." }); //
        }
        
        res.json({
            message: "Resposta de segurança verificada com sucesso.", //
            securityQuestion: user.securityQuestion //
        });

    } catch (error) {
        console.error("Admin - Erro ao verificar resposta de segurança:", error); //
        res.status(500).json({ message: "Erro ao verificar resposta de segurança." }); //
    }
});

// 10.4.6. Ajustar Saldo do Usuário (PATCH /api/admin/users/:userId/adjust-balance)
adminRouter.patch('/users/:userId/adjust-balance', async (req, res) => {
    const { userId } = req.params; //
    const { amount, balanceType, reason, operation = 'subtract' } = req.body; // balanceType: 'MT', 'bonusBalance', 'referralEarnings'

    if (!amount || typeof amount !== 'number' || amount <= 0) {
        return res.status(400).json({ message: "Valor (amount) inválido ou não fornecido." }); //
    }
    if (!balanceType || !['MT', 'bonusBalance', 'referralEarnings'].includes(balanceType)) {
        return res.status(400).json({ message: "Tipo de saldo (balanceType) inválido." }); //
    }
    if (!reason || reason.trim() === '') {
        return res.status(400).json({ message: "Motivo (reason) é obrigatório para o ajuste." }); //
    }
    if (!['add', 'subtract'].includes(operation)) {
        return res.status(400).json({ message: "Operação (operation) inválida. Use 'add' ou 'subtract'."});
    }

    try {
        const user = await User.findById(userId); //
        if (!user) {
            return res.status(404).json({ message: "Usuário não encontrado." }); //
        }

        let originalValue; //

        if (balanceType === 'MT') {
            originalValue = user.balance.MT || 0; //
            if (operation === 'subtract') {
                if (originalValue < amount) return res.status(400).json({ message: `Saldo MT insuficiente (${originalValue.toFixed(2)}) para remover ${amount.toFixed(2)}.` }); //
                user.balance.MT -= amount; //
            } else {
                user.balance.MT += amount; //
            }
        } else if (balanceType === 'bonusBalance') {
            originalValue = user.bonusBalance || 0; //
            if (operation === 'subtract') {
                if (originalValue < amount) return res.status(400).json({ message: `Saldo de Bônus insuficiente (${originalValue.toFixed(2)}) para remover ${amount.toFixed(2)}.` }); //
                user.bonusBalance -= amount; //
            } else {
                user.bonusBalance += amount; //
            }
        } else if (balanceType === 'referralEarnings') {
            originalValue = user.referralEarnings || 0; //
            if (operation === 'subtract') {
                if (originalValue < amount) return res.status(400).json({ message: `Saldo de Ganhos de Referência insuficiente (${originalValue.toFixed(2)}) para remover ${amount.toFixed(2)}.` }); //
                user.referralEarnings -= amount; //
            } else {
                user.referralEarnings += amount; //
            }
        }

        await user.save(); //
        // TODO: Adicionar Log de Ação Administrativa aqui
        console.log(`Admin ${req.user.id} ajustou saldo: User ${userId}, Tipo ${balanceType}, Op ${operation}, Valor ${amount}, Razão: ${reason}`);

        res.json({
            message: `Saldo ${balanceType} do usuário ${user.name} ${operation === 'subtract' ? 'reduzido' : 'aumentado'} em ${amount.toFixed(2)} MT. Motivo: ${reason}`, //
            user: {
                _id: user._id, name: user.name, balance: user.balance, //
                bonusBalance: user.bonusBalance, referralEarnings: user.referralEarnings //
            }
        });

    } catch (error) {
        console.error("Admin - Erro ao ajustar saldo do usuário:", error); //
        res.status(500).json({ message: "Erro interno ao ajustar saldo." }); //
    }
});

// 10.5. Gerenciamento de Saques
// 10.5.1. Listar todos os saques (com filtros) (GET /api/admin/withdrawals)
adminRouter.get('/withdrawals', async (req, res) => {
    const { status, userId, page = 1, limit = 10 } = req.query; //
    const query = {};
    if (status) query.status = status; //
    if (userId) query.userId = userId; //

    try {
        const withdrawals = await Withdrawal.find(query)
            .populate('userId', 'name email') //
            .sort({ requestedAt: -1 }) //
            .skip((parseInt(page) - 1) * parseInt(limit)) //
            .limit(parseInt(limit)); //

        const totalWithdrawals = await Withdrawal.countDocuments(query); //

        res.json({
            withdrawals, //
            totalPages: Math.ceil(totalWithdrawals / limit), //
            currentPage: parseInt(page), //
            totalCount: totalWithdrawals //
        });
    } catch (error) {
        console.error("Admin - Erro ao listar saques:", error); //
        res.status(500).json({ message: "Erro ao listar saques." }); //
    }
});
// 10.5.2. Processar (Aprovar/Rejeitar) Saque (PATCH /api/admin/withdrawals/:withdrawalId)
adminRouter.patch('/withdrawals/:withdrawalId', async (req, res) => {
    const { withdrawalId } = req.params; //
    const { status, adminNotes } = req.body; // status: 'Processado' ou 'Rejeitado' //

    if (!['Processado', 'Rejeitado'].includes(status)) {
        return res.status(400).json({ message: "Status inválido. Use 'Processado' ou 'Rejeitado'." }); //
    }

    try {
        const withdrawal = await Withdrawal.findById(withdrawalId); //
        if (!withdrawal) {
            return res.status(404).json({ message: "Solicitação de saque não encontrada." }); //
        }
        if (withdrawal.status !== 'Pendente') {
            return res.status(400).json({ message: `Este saque já foi ${withdrawal.status.toLowerCase()}.` }); //
        }

        withdrawal.status = status; //
        withdrawal.processedAt = new Date(); //
        if (adminNotes) withdrawal.adminNotes = adminNotes; //

        if (status === 'Rejeitado') {
            // Devolver o valor ao saldo do usuário
            const user = await User.findById(withdrawal.userId); //
            if (user) {
                // O valor total solicitado (withdrawal.amount) é devolvido.
                // A lógica de dedução original foi: MT, bonus, referral.
                // Para simplificar a devolução, adicionamos tudo de volta ao saldo MT principal.
                // Uma lógica mais complexa poderia tentar rastrear e devolver às fontes originais.
                user.balance.MT = (user.balance.MT || 0) + withdrawal.amount; //
                await user.save(); //
                console.log(`Admin: Saque ${withdrawalId} rejeitado. Valor ${withdrawal.amount} MT devolvido ao usuário ${user.email}.`); //
            } else {
                console.error(`Admin: Usuário ${withdrawal.userId} do saque rejeitado não encontrado para devolução de saldo.`); //
            }
        }
        // Se 'Processado', o dinheiro já foi "enviado" externamente. O saldo do usuário já foi debitado na solicitação.
        await withdrawal.save(); //
        // TODO: Notificar usuário sobre o status do saque (opcional)

        res.json({ message: `Saque ${status.toLowerCase()} com sucesso.`, withdrawal }); //

    } catch (error) {
        console.error(`Admin - Erro ao ${status === 'Processado' ? 'processar' : 'rejeitar'} saque:`, error); //
        res.status(500).json({ message: "Erro ao processar o saque." }); //
    }
});

// 10.6. Gerenciamento de Configurações Gerais do Site (AdminSetting)
// (Excluindo paymentMethods que já tem rotas dedicadas)
// 10.6.1. Listar todas as configurações (GET /api/admin/settings)
adminRouter.get('/settings', async (req, res) => {
    try {
        const settings = await AdminSetting.find({}); //
        const formattedSettings = {};
        settings.forEach(s => formattedSettings[s.key] = { value: s.value, description: s.description }); //
        res.json(formattedSettings);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar configurações.', error: error.message }); //
    }
});
// 10.6.2. Atualizar/Criar uma configuração (POST /api/admin/settings)
// ESTA ROTA É USADA PELO admin_settings.html PARA SALVAR AS NOVAS CONFIGURAÇÕES DE BÔNUS
adminRouter.post('/settings', async (req, res) => {
    const { key, value, description } = req.body; //
    if (!key || typeof value === 'undefined') { // typeof value === 'undefined' para permitir valor null ou string vazia
        return res.status(400).json({ message: 'Chave (key) e valor (value) são obrigatórios.' }); //
    }
    if (key === 'paymentMethods') {
        return res.status(400).json({ message: "Para atualizar métodos de pagamento, use a rota /api/admin/payment-methods." });
    }
  try {
        const setting = await AdminSetting.findOneAndUpdate(
            { key }, //
            { key, value, description }, //
            { upsert: true, new: true, runValidators: true } //
        );
        siteSettingsCache = null; // Invalidar cache
        await getSiteSettings(); // Recarregar cache
        res.json({ message: `Configuração '${key}' atualizada com sucesso.`, setting }); //
    } catch (error) {
        console.error("Erro ao atualizar configuração:", error);
        res.status(500).json({ message: 'Erro ao atualizar configuração.', error: error.message }); //
    }
});

// 10.7. Gerenciamento de Notificações/Comunicados para Usuários (Admin para Notification Schema)
// 10.7.1. Criar Notificação (POST /api/admin/notifications)
adminRouter.post('/notifications', async (req, res) => {
    const { title, message, type, targetAudience = 'all', targetUserId, expiresAt, link, isActive = true } = req.body; // Adicionado link e isActive //
    if (!title || !message || !type) {
        return res.status(400).json({ message: "Título, mensagem e tipo são obrigatórios." }); //
    }
    if (targetAudience === 'specificUser' && !mongoose.Types.ObjectId.isValid(targetUserId)) { //
        return res.status(400).json({ message: "targetUserId é obrigatório e deve ser um ID válido para targetAudience 'specificUser'." }); //
    }
    try {
        const notification = new Notification({ 
            title, message, type, targetAudience, 
            targetUserId: targetAudience === 'specificUser' ? targetUserId : null, 
            isActive, expiresAt, link
        }); //
        await notification.save(); //
        res.status(201).json({ message: "Notificação criada com sucesso.", notification }); //
    } catch (error) {
        console.error("Admin - Erro ao criar notificação:", error); //
        res.status(500).json({ message: "Erro ao criar notificação." }); //
    }
});
// 10.7.2. Listar Notificações (GET /api/admin/notifications)
adminRouter.get('/notifications', async (req, res) => {
    try {
        const { page = 1, limit = 10, type, targetAudience, isActive } = req.query;
        const query = {};
        if (type) query.type = type;
        if (targetAudience) query.targetAudience = targetAudience;
        if (typeof isActive !== 'undefined') query.isActive = isActive === 'true';


        const notifications = await Notification.find(query)
            .populate('targetUserId', 'name email') // Popular se for para usuário específico
            .sort({ createdAt: -1 }) //
            .skip((parseInt(page) - 1) * parseInt(limit))
            .limit(parseInt(limit));
        
        const totalNotifications = await Notification.countDocuments(query);

        res.json({
            notifications, //
            totalPages: Math.ceil(totalNotifications / limit),
            currentPage: parseInt(page),
            totalCount: totalNotifications
        });
    } catch (error) {
        console.error("Admin - Erro ao listar notificações:", error); //
        res.status(500).json({ message: "Erro ao listar notificações." }); //
    }
});

// 10.7.3. Editar Notificação (PUT /api/admin/notifications/:notificationId)
adminRouter.put('/notifications/:notificationId', async (req, res) => {
    const { notificationId } = req.params; //
    const { title, message, type, targetAudience, targetUserId, isActive, expiresAt, link } = req.body; //
    
    if (targetAudience === 'specificUser' && !mongoose.Types.ObjectId.isValid(targetUserId)) {
        return res.status(400).json({ message: "targetUserId é obrigatório e deve ser um ID válido para targetAudience 'specificUser'." });
    }

    try {
        const updateData = { title, message, type, targetAudience, isActive, expiresAt, link };
        if (targetAudience === 'specificUser') {
            updateData.targetUserId = targetUserId;
        } else {
            updateData.targetUserId = null; // Limpar se não for específico
        }

        const notification = await Notification.findByIdAndUpdate(notificationId, updateData, { new: true, runValidators: true }); // Adicionado runValidators
        if (!notification) return res.status(404).json({ message: "Notificação não encontrada." }); //
        res.json({ message: "Notificação atualizada com sucesso.", notification }); //
    } catch (error) {
        console.error("Admin - Erro ao atualizar notificação:", error); //
        res.status(500).json({ message: "Erro ao atualizar notificação." }); //
    }
});
// 10.7.4. Deletar Notificação (DELETE /api/admin/notifications/:notificationId)
adminRouter.delete('/notifications/:notificationId', async (req, res) => {
    try {
        const notification = await Notification.findByIdAndDelete(req.params.notificationId); //
        if (!notification) return res.status(404).json({ message: "Notificação não encontrada." }); //
        
        // Opcional: Deletar também os UserNotificationStatus associados
        await UserNotificationStatus.deleteMany({ notificationId: req.params.notificationId });

        res.json({ message: "Notificação deletada com sucesso." }); //
    } catch (error) {
        console.error("Admin - Erro ao deletar notificação:", error); //
        res.status(500).json({ message: "Erro ao deletar notificação." }); //
    }
});

// 10.8. Estatísticas Gerais (GET /api/admin/stats/overview)
adminRouter.get('/stats/overview', async (req, res) => {
    try {
        const totalUsers = await User.countDocuments(); //
        const activeUsers = await User.countDocuments({ lastLoginAt: { $gte: new Date(new Date() - 30 * 24 * 60 * 60 * 1000) } }); // Logados nos últimos 30 dias
        
        const depositAggregation = await Deposit.aggregate([ //
            { $match: { status: 'Confirmado' } }, //
            { $group: { _id: null, total: { $sum: '$amount' } } } //
        ]);
        const totalDeposited = depositAggregation.length > 0 ? depositAggregation[0].total : 0; //

        const withdrawalAggregation = await Withdrawal.aggregate([ //
            { $match: { status: 'Processado' } }, //
            { $group: { _id: null, total: { $sum: '$amount' } } } //
        ]);
        const totalWithdrawn = withdrawalAggregation.length > 0 ? withdrawalAggregation[0].total : 0; //

        const pendingDepositsCount = await Deposit.countDocuments({ status: 'Pendente' }); //
        const pendingWithdrawalsCount = await Withdrawal.countDocuments({ status: 'Pendente' }); //

        const plans = await Plan.find({isActive: true}).select('name _id'); //
        const activeInvestmentsByPlan = {};
        for (const plan of plans) {
            activeInvestmentsByPlan[plan.name] = await User.countDocuments({'activeInvestments.planId': plan._id}); //
        }
      res.json({
            totalUsers, activeUsers, totalDeposited, totalWithdrawn, //
            pendingDepositsCount, pendingWithdrawalsCount, activeInvestmentsByPlan //
        });
    } catch (error) {
        console.error("Admin - Erro ao buscar estatísticas:", error); //
        res.status(500).json({ message: "Erro ao buscar estatísticas." }); //
    }
});

// 10.9. Gerenciar Claims (Admin View) (GET /api/admin/claims)
adminRouter.get('/claims', async (req, res) => {
    const { userId, planId, currency, page = 1, limit = 20 } = req.query; //
    let userQuery = {};
    let aggregationPipeline = [];

    // Se userId for fornecido, filtramos por esse usuário
    if (userId) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ message: "ID de usuário inválido." });
        }
        userQuery._id = new mongoose.Types.ObjectId(userId); //
}
    // Construir pipeline de agregação para buscar claims de todos os usuários ou de um específico
    aggregationPipeline.push({ $match: userQuery }); // Filtra por usuário, se aplicável
    aggregationPipeline.push({ $unwind: '$claimHistory' }); // Expande o array claimHistory

    // Aplicar filtros adicionais sobre os claims expandidos
    const claimFilters = {};
    if (planId) {
        if (!mongoose.Types.ObjectId.isValid(planId)) {
            return res.status(400).json({ message: "ID de plano inválido." });
        }
        claimFilters['claimHistory.planId'] = new mongoose.Types.ObjectId(planId); //
    }
    if (currency) {
        claimFilters['claimHistory.currency'] = currency.toUpperCase(); //
    }
    if (Object.keys(claimFilters).length > 0) {
        aggregationPipeline.push({ $match: claimFilters });
    }

    // Adicionar informações do usuário e do plano ao claim
    aggregationPipeline.push({
        $lookup: { // Popular nome do plano
            from: 'plans', // Nome da coleção de planos
            localField: 'claimHistory.planId',
            foreignField: '_id',
            as: 'planDetails'
        }
    });
    
    // Contar o total de documentos ANTES da paginação, mas DEPOIS dos filtros
    const countPipeline = [...aggregationPipeline, { $count: 'totalCount' }];

    // Aplicar ordenação, skip e limit para paginação
    aggregationPipeline.push({ $sort: { 'claimHistory.claimedAt': -1 } });
    aggregationPipeline.push({ $skip: (parseInt(page) - 1) * parseInt(limit) });
    aggregationPipeline.push({ $limit: parseInt(limit) });

    // Projetar o formato final
    aggregationPipeline.push({
        $project: {
            _id: '$claimHistory._id', // ID do claim
            userId: '$_id', // ID do usuário
            userName: '$name',
            userEmail: '$email',
            planId: '$claimHistory.planId',
            planName: { $ifNull: [ { $arrayElemAt: ['$planDetails.name', 0] }, '$claimHistory.planName' ] },
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
            claims, //
            totalPages: Math.ceil(totalClaims / limit), //
            currentPage: parseInt(page), //
            totalCount: totalClaims //
        });

    } catch (error) {
        console.error("Admin - Erro ao listar claims:", error); //
        res.status(500).json({ message: "Erro ao listar claims." }); //
    }
});

// 10.10. Gerenciamento de Promoções Urgentes (Admin)
adminRouter.post('/urgent-promotions', async (req, res) => {
    const { title, image, description, expiresAt, link, badgeText, isActive } = req.body;
    if (!title || !expiresAt) return res.status(400).json({ message: "Título e data de expiração são obrigatórios." });
    try {
        const newPromotion = new UrgentPromotion({ title, image, description, expiresAt, link, badgeText, isActive });
        await newPromotion.save();
        res.status(201).json({ message: "Promoção urgente criada com sucesso.", promotion: newPromotion });
    } catch (error) {
        console.error("Admin - Erro ao criar promoção urgente:", error);
        res.status(500).json({ message: "Erro ao criar promoção urgente.", error: error.message });
    }
});

adminRouter.get('/urgent-promotions', async (req, res) => {
    try {
        const { page = 1, limit = 10, activeOnly } = req.query;
        const query = {};
        if (activeOnly === 'true') { query.isActive = true; query.expiresAt = { $gte: new Date() }; }
        else if (activeOnly === 'false') { query.isActive = false; }

        const promotions = await UrgentPromotion.find(query).sort({ createdAt: -1 }).skip((parseInt(page)-1)*parseInt(limit)).limit(parseInt(limit));
        const totalPromotions = await UrgentPromotion.countDocuments(query);
        res.json({ promotions, totalPages: Math.ceil(totalPromotions/limit), currentPage: parseInt(page), totalCount: totalPromotions });
    } catch (error) {
        console.error("Admin - Erro ao listar promoções urgentes:", error);
        res.status(500).json({ message: "Erro ao listar promoções urgentes." });
    }
});

adminRouter.put('/urgent-promotions/:promotionId', async (req, res) => {
    const { promotionId } = req.params;
    const { title, image, description, expiresAt, link, badgeText, isActive } = req.body;
    if (!title || !expiresAt) return res.status(400).json({ message: "Título e data de expiração são obrigatórios." });
    try {
        const updatedPromotion = await UrgentPromotion.findByIdAndUpdate(promotionId,
            { title, image, description, expiresAt, link, badgeText, isActive }, { new: true, runValidators: true });
        if (!updatedPromotion) return res.status(404).json({ message: "Promoção não encontrada." });
        res.json({ message: "Promoção urgente atualizada com sucesso.", promotion: updatedPromotion });
    } catch (error) {
        console.error("Admin - Erro ao atualizar promoção urgente:", error);
        res.status(500).json({ message: "Erro ao atualizar promoção urgente.", error: error.message });
    }
});
adminRouter.delete('/urgent-promotions/:promotionId', async (req, res) => {
    const { promotionId } = req.params;
    try {
        const deletedPromotion = await UrgentPromotion.findByIdAndDelete(promotionId);
        if (!deletedPromotion) return res.status(404).json({ message: "Promoção não encontrada." });
        res.json({ message: "Promoção urgente deletada com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar promoção urgente:", error);
        res.status(500).json({ message: "Erro ao deletar promoção urgente." });
    }
});

// 10.11. Gerenciamento de Banners da Homepage (Admin)
adminRouter.post('/homepage-banners', async (req, res) => {
    const {
        title, mediaType, mediaUrl, videoPlatform, textOverlay,
        ctaText, ctaLink, backgroundColor, textColor, order, isActive
    } = req.body;

    if (!mediaType || !mediaUrl) {
        return res.status(400).json({ message: "Tipo de mídia e URL da mídia são obrigatórios." });
    }
    if (mediaType === 'video' && !videoPlatform) {
        return res.status(400).json({ message: "Plataforma do vídeo é obrigatória para o tipo 'video'." });
    }
    if (mediaType === 'video' && !['youtube', 'vimeo', 'local', 'other'].includes(videoPlatform)) {
        return res.status(400).json({ message: "Plataforma do vídeo inválida." });
    }

    try {
        const newBanner = new HomepageBanner({
            title, mediaType, mediaUrl, videoPlatform, textOverlay,
            ctaText, ctaLink, backgroundColor, textColor, order, isActive
        });
        await newBanner.save();
        res.status(201).json({ message: "Banner da homepage criado com sucesso.", banner: newBanner });
    } catch (error) {
        console.error("Admin - Erro ao criar banner da homepage:", error);
        res.status(500).json({ message: "Erro ao criar banner.", error: error.message });
    }
});

adminRouter.get('/homepage-banners', async (req, res) => {
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
adminRouter.put('/homepage-banners/:bannerId', async (req, res) => {
    const { bannerId } = req.params;
    const {
        title, mediaType, mediaUrl, videoPlatform, textOverlay,
        ctaText, ctaLink, backgroundColor, textColor, order, isActive
    } = req.body;

    if (!mediaType || !mediaUrl) {
        return res.status(400).json({ message: "Tipo de mídia e URL da mídia são obrigatórios." });
    }
    if (mediaType === 'video' && !videoPlatform) {
        return res.status(400).json({ message: "Plataforma do vídeo é obrigatória para o tipo 'video'." });
    }
     if (mediaType === 'video' && !['youtube', 'vimeo', 'local', 'other'].includes(videoPlatform)) {
        return res.status(400).json({ message: "Plataforma do vídeo inválida." });
    }

    try {
        const updatedBanner = await HomepageBanner.findByIdAndUpdate(bannerId,
            {
                title, mediaType, mediaUrl, videoPlatform, textOverlay,
                ctaText, ctaLink, backgroundColor, textColor, order, isActive,
                updatedAt: Date.now()
            }, { new: true, runValidators: true }
        );
        if (!updatedBanner) return res.status(404).json({ message: "Banner não encontrado." });
        res.json({ message: "Banner da homepage atualizado com sucesso.", banner: updatedBanner });
    } catch (error) {
        console.error("Admin - Erro ao atualizar banner da homepage:", error);
        res.status(500).json({ message: "Erro ao atualizar banner.", error: error.message });
    }
});

adminRouter.delete('/homepage-banners/:bannerId', async (req, res) => {
    const { bannerId } = req.params;
    try {
        const deletedBanner = await HomepageBanner.findByIdAndDelete(bannerId);
        if (!deletedBanner) return res.status(404).json({ message: "Banner não encontrado." });
        res.json({ message: "Banner da homepage deletado com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar banner da homepage:", error);
        res.status(500).json({ message: "Erro ao deletar banner." });
    }
});
// 10.12. Gerenciamento do Blog (Admin)
// 10.12.1. Categorias do Blog (Admin)
const blogCategoryRouter = express.Router();

blogCategoryRouter.post('/', async (req, res) => {
    const { name, description, slug } = req.body;
    if (!name) return res.status(400).json({ message: "Nome da categoria é obrigatório." });
    try {
        let categorySlug = slug;
        if (!slug && name) {
             categorySlug = name.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
        }
        const existingCategory = await BlogCategory.findOne({ $or: [{name: name}, {slug: categorySlug}] });
        if (existingCategory) return res.status(409).json({ message: "Categoria com este nome ou slug já existe." });
        const newCategory = new BlogCategory({ name, description, slug: categorySlug });
        await newCategory.save();
        res.status(201).json(newCategory);
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "Categoria com este nome ou slug já existe (erro de duplicidade)." });
        console.error("Admin - Erro ao criar categoria do blog:", error);
        res.status(500).json({ message: "Erro ao criar categoria.", error: error.message });
    }
});
blogCategoryRouter.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 100, search = '' } = req.query; 
        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { slug: { $regex: search, $options: 'i' } }
            ];
        }
        const categories = await BlogCategory.find(query).sort({ name: 1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit));

        const totalCategories = await BlogCategory.countDocuments(query);
        res.json({ categories, totalPages: Math.ceil(totalCategories / limit), currentPage: parseInt(page), totalCount: totalCategories });
    } catch (error) {
        console.error("Admin - Erro ao listar categorias do blog:", error);
        res.status(500).json({ message: "Erro ao listar categorias." });
    }
});
blogCategoryRouter.get('/:categoryId', async (req, res) => {
    try {
        const category = await BlogCategory.findById(req.params.categoryId);
        if (!category) return res.status(404).json({ message: "Categoria não encontrada." });
        res.json(category);
    } catch (error) {
        console.error("Admin - Erro ao buscar categoria do blog:", error);
        res.status(500).json({ message: "Erro ao buscar categoria." });
    }
});
blogCategoryRouter.put('/:categoryId', async (req, res) => {
    const { name, description, slug } = req.body;
    if (!name) return res.status(400).json({ message: "Nome da categoria é obrigatório." });
    try {
        let categorySlug = slug;
        if (!slug && name) {
             categorySlug = name.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
        }
        const existingCategory = await BlogCategory.findOne({ $or: [{name: name}, {slug: categorySlug}], _id: { $ne: req.params.categoryId } });
        if (existingCategory) return res.status(409).json({ message: "Outra categoria com este nome ou slug já existe." });
        const updatedCategory = await BlogCategory.findByIdAndUpdate(req.params.categoryId, { name, description, slug: categorySlug }, { new: true, runValidators: true });
        if (!updatedCategory) return res.status(404).json({ message: "Categoria não encontrada." });
        res.json(updatedCategory);
    } catch (error) {
         if (error.code === 11000) return res.status(409).json({ message: "Outra categoria com este nome ou slug já existe (erro de duplicidade)." });
        console.error("Admin - Erro ao atualizar categoria do blog:", error);
        res.status(500).json({ message: "Erro ao atualizar categoria.", error: error.message });
    }
});
blogCategoryRouter.delete('/:categoryId', async (req, res) => {
    try {
        const postsWithCategory = await BlogPost.countDocuments({ category: req.params.categoryId });
        if (postsWithCategory > 0) return res.status(400).json({ message: `Não é possível deletar. Categoria está associada a ${postsWithCategory} post(s).` });
        const deletedCategory = await BlogCategory.findByIdAndDelete(req.params.categoryId);
        if (!deletedCategory) return res.status(404).json({ message: "Categoria não encontrada." });
        res.json({ message: "Categoria deletada com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar categoria do blog:", error);
        res.status(500).json({ message: "Erro ao deletar categoria." });
    }
});
adminRouter.use('/blog/categories', blogCategoryRouter);

// 10.12.2. Tags do Blog (Admin)
const blogTagRouter = express.Router();
blogTagRouter.post('/', async (req, res) => {
    const { name, slug } = req.body;
    if (!name) return res.status(400).json({ message: "Nome da tag é obrigatório." });
    try {
        let tagSlug = slug;
        if (!slug && name) {
             tagSlug = name.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
        }
        const existingTag = await BlogTag.findOne({ $or: [{name: name}, {slug: tagSlug}] });
        if (existingTag) return res.status(409).json({ message: "Tag com este nome ou slug já existe." });
        const newTag = new BlogTag({ name, slug: tagSlug });
        await newTag.save();
        res.status(201).json(newTag);
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "Tag com este nome ou slug já existe (erro de duplicidade)." });
        console.error("Admin - Erro ao criar tag do blog:", error);
        res.status(500).json({ message: "Erro ao criar tag.", error: error.message });
    }
});
blogTagRouter.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 100, search = '' } = req.query; 
        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { slug: { $regex: search, $options: 'i' } }
            ];
        }
        const tags = await BlogTag.find(query).sort({ name: 1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit));
        const totalTags = await BlogTag.countDocuments(query);
        res.json({ tags, totalPages: Math.ceil(totalTags/limit), currentPage: parseInt(page), totalCount: totalTags });
    } catch (error) {
        console.error("Admin - Erro ao listar tags do blog:", error);
        res.status(500).json({ message: "Erro ao listar tags." });
    }
});
blogTagRouter.get('/:tagId', async (req, res) => {
    try {
        const tag = await BlogTag.findById(req.params.tagId);
        if (!tag) return res.status(404).json({ message: "Tag não encontrada." });
        res.json(tag);
    } catch (error) {
        console.error("Admin - Erro ao buscar tag do blog:", error);
        res.status(500).json({ message: "Erro ao buscar tag." });
    }
});
blogTagRouter.put('/:tagId', async (req, res) => {
    const { name, slug } = req.body;
    if (!name) return res.status(400).json({ message: "Nome da tag é obrigatório." });
    try {
        let tagSlug = slug;
        if (!slug && name) {
             tagSlug = name.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
        }
        const existingTag = await BlogTag.findOne({ $or: [{name: name}, {slug: tagSlug}], _id: { $ne: req.params.tagId } });
        if (existingTag) return res.status(409).json({ message: "Outra tag com este nome ou slug já existe." });
        const updatedTag = await BlogTag.findByIdAndUpdate(req.params.tagId, { name, slug: tagSlug }, { new: true, runValidators: true });
        if (!updatedTag) return res.status(404).json({ message: "Tag não encontrada." });
        res.json(updatedTag);
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "Outra tag com este nome ou slug já existe (erro de duplicidade)." });
        console.error("Admin - Erro ao atualizar tag do blog:", error);
        res.status(500).json({ message: "Erro ao atualizar tag.", error: error.message });
    }
});
blogTagRouter.delete('/:tagId', async (req, res) => {
    try {
        const postsWithTag = await BlogPost.countDocuments({ tags: req.params.tagId });
        if (postsWithTag > 0) return res.status(400).json({ message: `Não é possível deletar. Tag está associada a ${postsWithTag} post(s).` });
        const deletedTag = await BlogTag.findByIdAndDelete(req.params.tagId);
        if (!deletedTag) return res.status(404).json({ message: "Tag não encontrada." });
        res.json({ message: "Tag deletada com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar tag do blog:", error);
        res.status(500).json({ message: "Erro ao deletar tag." });
    }
});
adminRouter.use('/blog/tags', blogTagRouter);
// 10.12.3. Posts do Blog (Admin)
const blogPostRouter = express.Router();
blogPostRouter.post('/', async (req, res) => {
    const { title, slug, content, excerpt, coverImage, category, tags, status, isFeatured, publishedAt, seoTitle, seoDescription, seoKeywords } = req.body;
    if (!title || !content) return res.status(400).json({ message: "Título e conteúdo são obrigatórios." });
    if (status === 'scheduled' && !publishedAt) return res.status(400).json({ message: "Data de publicação (publishedAt) é obrigatória para posts agendados." });
    if (status === 'scheduled' && new Date(publishedAt) <= new Date()) return res.status(400).json({ message: "Data de publicação para agendamento deve ser no futuro." });
    try {
        let postSlug = slug;
        if (!slug && title) { postSlug = title.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, ''); }
        const existingPost = await BlogPost.findOne({ slug: postSlug });
        if (existingPost) return res.status(409).json({ message: "Post com este slug já existe." });
        let finalPublishedAt = publishedAt;
        if (status === 'published' && !publishedAt) finalPublishedAt = new Date();
        const newPost = new BlogPost({ title, slug: postSlug, content, excerpt, coverImage, category: category || null, tags: tags || [], author: req.user.id, status, isFeatured, publishedAt: finalPublishedAt, seoTitle, seoDescription, seoKeywords });
        await newPost.save();
        res.status(201).json(newPost);
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: "Post com este slug já existe (erro de duplicidade)." });
        console.error("Admin - Erro ao criar post do blog:", error);
        res.status(500).json({ message: "Erro ao criar post.", error: error.message });
    }
});
blogPostRouter.get('/', async (req, res) => {
    const { page = 1, limit = 10, search = '', status, category, tag, author, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const query = {};
    if (search) { query.$or = [ { title: { $regex: search, $options: 'i' } }, { content: { $regex: search, $options: 'i' } }, { excerpt: { $regex: search, $options: 'i' } } ]; }
    if (status) query.status = status;
    if (category) query.category = category;
    if (tag) query.tags = tag;
    if (author) query.author = author;
    try {
        const posts = await BlogPost.find(query).populate('category', 'name slug').populate('tags', 'name slug').populate('author', 'name email').sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 }).skip((parseInt(page) - 1) * parseInt(limit)).limit(parseInt(limit));
        const totalPosts = await BlogPost.countDocuments(query);
        res.json({ posts, totalPages: Math.ceil(totalPosts / limit), currentPage: parseInt(page), totalCount: totalPosts });
    } catch (error) {
        console.error("Admin - Erro ao listar posts do blog:", error);
        res.status(500).json({ message: "Erro ao listar posts." });
    }
});
blogPostRouter.get('/:postId', async (req, res) => {
    try {
        const post = await BlogPost.findById(req.params.postId).populate('category', 'name slug _id').populate('tags', 'name slug _id').populate('author', 'name email');
        if (!post) return res.status(404).json({ message: "Post não encontrado." });
        res.json(post);
    } catch (error) {
        console.error("Admin - Erro ao buscar post do blog:", error);
        res.status(500).json({ message: "Erro ao buscar post." });
    }
});
blogPostRouter.delete('/:postId', async (req, res) => {
    try {
        const deletedPost = await BlogPost.findByIdAndDelete(req.params.postId);
        if (!deletedPost) return res.status(404).json({ message: "Post não encontrado." });
        res.json({ message: "Post deletado com sucesso." });
    } catch (error) {
        console.error("Admin - Erro ao deletar post do blog:", error);
        res.status(500).json({ message: "Erro ao deletar post." });
    }
});
adminRouter.use('/blog/posts', blogPostRouter);

app.use('/api/admin', adminRouter);
// server.js
// ... (continuação da Parte 10: ROTAS DO ADMINISTRADOR, conforme seu arquivo original server (5).js)

// -----------------------------------------------------------------------------
// ROTA RAIZ (Exemplo)
// -----------------------------------------------------------------------------
// A rota /api já está definida no seu código original dentro do placeholder para rotas.
// Se precisar de uma rota raiz geral para a API:
app.get('/api', (req, res) => {
    res.json({ message: 'Bem-vindo à API da Plataforma de Investimentos GoldMT! Versão aprimorada.' }); //
});


// -----------------------------------------------------------------------------
// TRATAMENTO DE ERROS (Exemplo Básico)
// -----------------------------------------------------------------------------
// Middleware para tratar rotas não encontradas (404)
app.use((req, res, next) => {
    res.status(404).json({ message: 'Endpoint não encontrado.' });
});

// Middleware de tratamento de erro genérico (deve ser o último middleware)
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
    console.error("Erro não tratado:", error);
    // Evitar vazar detalhes do erro em produção
    const status = error.status || 500;
    const message = error.message && status < 500 ? error.message : 'Erro interno do servidor.';
    res.status(status).json({ message });
});


// -----------------------------------------------------------------------------
// INICIALIZAÇÃO DO SERVIDOR
// -----------------------------------------------------------------------------
// A lógica de escutar em 0.0.0.0 é boa para ambientes de contêiner/produção.
// Para desenvolvimento local, apenas PORT é suficiente.
// A variável de ambiente NODE_ENV pode ser usada para distinguir.

if (process.env.NODE_ENV === 'production') {
    app.listen(PORT, '0.0.0.0', () => { // Escutar em 0.0.0.0 para acesso externo (ex: Docker, Render)
        console.log(`Servidor rodando em modo de PRODUÇÃO na porta ${PORT} e acessível externamente.`); //
        console.log(`Frontend URL configurada: ${FRONTEND_URL}`); //
    });
} else {
    app.listen(PORT, () => {
       console.log(`Servidor rodando em modo de DESENVOLVIMENTO na porta ${PORT}`); //
       console.log(`Frontend URL configurada: ${FRONTEND_URL}`); //
       // Não logar JWT_SECRET em produção
       // console.log(`JWT Secret (apenas para debug, NÃO USE EM PRODUÇÃO): ${JWT_SECRET}`);
    });
}

// Fim do arquivo server.js
