import { useState, useEffect, useCallback, useRef } from "react";
import emailjs from "@emailjs/browser";
import { createClient } from "@supabase/supabase-js";

// ── CONFIG ────────────────────────────────────────────────────
const SUPABASE_URL = "https://duiqiuhtcmjjpaqesfwc.supabase.co";
const SUPABASE_KEY = "sb_publishable_WWWCeed957e0VSaaVeG0mw_MW0w_aGh";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const EMAILJS_SERVICE_ID  = "service_mir3von";
const EMAILJS_TEMPLATE_ID = "template_ooxmhdi";
const EMAILJS_PUBLIC_KEY  = "9MdUv4yR4Ax4lWQmW";
const ADMIN_EMAIL         = "aosf2026@gmail.com";
const PAYSTACK_PUBLIC_KEY = "pk_live_YOUR_PAYSTACK_KEY";
const STRIPE_PAYMENT_LINK     = "https://buy.stripe.com/6oU6oG5a7aLGaok2f2cwg00";
const STRIPE_REACTIVATION_LINK = "https://buy.stripe.com/fZu3cucCz8Dy9kg7zmcwg01";

const REGIONS = {
  africa: {
    label: "Africa (Paystack)",
    countries: ["Nigeria","Ghana","Kenya","South Africa","Uganda","Tanzania",
      "Rwanda","Zambia","Zimbabwe","Malawi","Botswana","Namibia","Lesotho",
      "Eswatini","South Sudan","Sudan","Somalia","Eritrea","Sierra Leone",
      "Liberia","Gambia","Cameroon","Ethiopia","Other English-speaking African Country"],
    currency: "NGN",
    processor: "paystack",
    flag: "🌍",
  },
  canada: {
    label: "Canada (Stripe)",
    countries: ["Canada"],
    currency: "CAD",
    processor: "stripe",
    flag: "🇨🇦",
  },
  usa: {
    label: "United States (Stripe)",
    countries: ["United States"],
    currency: "USD",
    processor: "stripe",
    flag: "🇺🇸",
  },
  uk: {
    label: "United Kingdom (Stripe)",
    countries: ["United Kingdom"],
    currency: "GBP",
    processor: "stripe",
    flag: "🇬🇧",
  },
};

// Exchange rates (approximate — update periodically)
const RATES = { NGN: 1600, CAD: 1.36, USD: 1, GBP: 0.79 };
const toUSD = (amount, currency) => amount / RATES[currency];
const fromUSD = (amount, currency) => Math.round(amount * RATES[currency] * 100) / 100;
const ADMIN_PASSWORD      = "AOSF2026@RoyalTech";

const APP_FEE_USD      = 5;    // USD 5 application/reactivation fee
const DIRECT_CREDIT    = 1;    // USD 1 per direct referral
const INDIRECT1_CREDIT = 1;    // USD 1 per 1st extension
const INDIRECT2_CREDIT = 1;    // USD 1 per 2nd extension
const LINK_CAP         = 1000; // Link expires after USD 1,000 earned

// NGN equivalent at ~1600 per USD (display only)
const USD_TO_NGN = 1600;

const ELIGIBLE_COUNTRIES = [
  "Nigeria","Ghana","Kenya","South Africa","Uganda","Tanzania","Rwanda",
  "Ethiopia","Cameroon","Sierra Leone","Liberia","Gambia","Zambia",
  "Zimbabwe","Malawi","Botswana","Namibia","Lesotho","Eswatini",
  "South Sudan","Sudan","Somalia","Eritrea","Other English-speaking African Country",
  "Canada","United States","United Kingdom",
];

// Stripe checkout — no client-side Stripe.js needed for redirect flow

const sendEmail = async (params) => {
  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID,
      { ...params, admin_email: ADMIN_EMAIL }, EMAILJS_PUBLIC_KEY);
  } catch (err) { console.error("Email error:", err); }
};

const fmtUSD = (n) => "USD " + Number(n).toFixed(2);
const fmtNGN = (n) => "NGN " + Math.round(n * USD_TO_NGN).toLocaleString();

const generateCode = (name, country) => {
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0,3);
  const ctry = country.substring(0,2).toUpperCase();
  const rand = Math.random().toString(36).substring(2,6).toUpperCase();
  return `AOSF-${initials}-${ctry}-${rand}`;
};

// ── SUPABASE HELPERS ──────────────────────────────────────────
const DB = {
  async getApplicants() {
    const { data, error } = await supabase.from("aosf_applicants").select("*");
    if (error) { console.error("getApplicants:", error); return {}; }
    return Object.fromEntries(data.map(a => [a.ref_code, {
      fullName: a.full_name, email: a.email, phone: a.phone,
      country: a.country, institution: a.institution, course: a.course,
      level: a.level, referredBy: a.referred_by, refCode: a.ref_code,
      accountName: a.account_name, accountNumber: a.account_number,
      accountBank: a.account_bank, accountCountry: a.account_country,
      balance: Number(a.balance || 0), totalEarned: Number(a.total_earned || 0),
      totalWithdrawn: Number(a.total_withdrawn || 0),
      linkEarned: Number(a.link_earned || 0),
      linkActive: a.link_active, linkCycle: Number(a.link_cycle || 1),
      status: a.status, registeredAt: a.registered_at,
      appFeePaid: a.app_fee_paid,
    }]));
  },

  async insertApplicant(code, a) {
    const { error } = await supabase.from("aosf_applicants").insert({
      ref_code: code, full_name: a.fullName, email: a.email,
      phone: a.phone, country: a.country, institution: a.institution,
      course: a.course, level: a.level, referred_by: a.referredBy || null,
      account_name: a.accountName, account_number: a.accountNumber,
      account_bank: a.accountBank, account_country: a.accountCountry,
      balance: 0, total_earned: 0, total_withdrawn: 0, link_earned: 0,
      link_active: false, link_cycle: 1, status: "pending",
      app_fee_paid: false,
    });
    if (error) { console.error("insertApplicant:", error); throw new Error(error.message); }
    return true;
  },

  async activateApplicant(code) {
    const { error } = await supabase.from("aosf_applicants")
      .update({ app_fee_paid: true, link_active: true, status: "active" })
      .eq("ref_code", code);
    if (error) console.error("activateApplicant:", error);
  },

  async creditApplicant(code, amount, type) {
    const { data: current } = await supabase.from("aosf_applicants")
      .select("balance,total_earned,link_earned,link_active,link_cycle")
      .eq("ref_code", code).single();
    if (!current) return 0;

    const newBalance = Number(current.balance) + amount;
    const newTotal = Number(current.total_earned) + amount;
    const newLinkEarned = Number(current.link_earned) + amount;
    const linkActive = newLinkEarned < LINK_CAP;

    await supabase.from("aosf_applicants").update({
      balance: newBalance,
      total_earned: newTotal,
      link_earned: newLinkEarned,
      link_active: linkActive,
    }).eq("ref_code", code);

    // Log the credit
    await supabase.from("aosf_credits").insert({
      recipient_code: code, amount, credit_type: type,
    });

    return newLinkEarned;
  },

  async requestWithdrawal(code, amount) {
    const { error } = await supabase.from("aosf_withdrawals").insert({
      applicant_code: code, amount, status: "pending",
    });
    if (error) console.error("requestWithdrawal:", error);
    // Deduct from balance immediately
    const { data: current } = await supabase.from("aosf_applicants")
      .select("balance,total_withdrawn").eq("ref_code", code).single();
    if (current) {
      await supabase.from("aosf_applicants").update({
        balance: Math.max(0, Number(current.balance) - amount),
        total_withdrawn: Number(current.total_withdrawn) + amount,
      }).eq("ref_code", code);
    }
    return !error;
  },

  async reactivateLink(code) {
    const { data: current } = await supabase.from("aosf_applicants")
      .select("link_cycle").eq("ref_code", code).single();
    const { error } = await supabase.from("aosf_applicants").update({
      link_active: true,
      link_earned: 0,
      link_cycle: Number(current?.link_cycle || 1) + 1,
      status: "active",
    }).eq("ref_code", code);
    if (error) console.error("reactivateLink:", error);
  },

  async getCredits(code) {
    const { data, error } = await supabase.from("aosf_credits")
      .select("*").eq("recipient_code", code).order("created_at", { ascending: false });
    if (error) return [];
    return data.map(c => ({
      id: c.id, amount: Number(c.amount), type: c.credit_type, createdAt: c.created_at,
    }));
  },

  async getWithdrawals(code) {
    const { data, error } = await supabase.from("aosf_withdrawals")
      .select("*").eq("applicant_code", code).order("created_at", { ascending: false });
    if (error) return [];
    return data.map(w => ({
      id: w.id, amount: Number(w.amount), status: w.status,
      processedAt: w.processed_at, createdAt: w.created_at,
    }));
  },

  async getAllWithdrawals() {
    const { data, error } = await supabase.from("aosf_withdrawals")
      .select("*").order("created_at", { ascending: false });
    if (error) return [];
    return data;
  },

  async processWithdrawal(id) {
    await supabase.from("aosf_withdrawals")
      .update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", id);
  },

  getCurrentUser() { try { return localStorage.getItem("aosf_current_user"); } catch { return null; } },
  setCurrentUser(c) { try { localStorage.setItem("aosf_current_user", c); } catch {} },
  clearCurrentUser() { try { localStorage.removeItem("aosf_current_user"); } catch {} },
};

// ── STYLES ────────────────────────────────────────────────────
const GREEN       = "#1A6B3C";
const GREEN_DARK  = "#0F4526";
const GREEN_LIGHT = "#2D9B5A";
const GOLD        = "#C9A84C";
const GOLD_BG     = "#FFF9EC";
const WHITE       = "#FFFFFF";
const BG          = "#F0F6F2";
const MUTED       = "#6B7A6E";
const ERROR       = "#9F1239";
const SUCCESS     = "#166534";
const NAVY        = "#1B3A6B";

const css = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Inter',system-ui,sans-serif;background:${BG};color:#1a1a2e}
  .app{min-height:100vh}

  .nav{background:${GREEN_DARK};padding:0 24px;display:flex;align-items:center;
    justify-content:space-between;height:64px;position:sticky;top:0;z-index:100;
    box-shadow:0 2px 20px rgba(0,0,0,0.3)}
  .nav-logo{display:flex;align-items:center;gap:10px;cursor:pointer}
  .nav-logo-mark{background:${GOLD};color:${GREEN_DARK};font-weight:900;font-size:13px;
    width:44px;height:44px;border-radius:8px;display:flex;align-items:center;
    justify-content:center;text-align:center;line-height:1.2}
  .nav-brand{color:${WHITE};font-size:14px;font-weight:700;letter-spacing:.3px}
  .nav-sub{color:${GOLD};font-size:10px;letter-spacing:1px;text-transform:uppercase}
  .nav-links{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .nav-btn{background:transparent;border:1px solid rgba(255,255,255,0.3);color:${WHITE};
    padding:7px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s}
  .nav-btn:hover{background:rgba(255,255,255,0.1)}
  .nav-btn.gold{background:${GOLD};border-color:${GOLD};color:${GREEN_DARK};font-weight:700}

  .hero{background:linear-gradient(135deg,${GREEN_DARK} 0%,${GREEN} 60%,${GREEN_LIGHT} 100%);
    padding:80px 24px 64px;text-align:center;position:relative;overflow:hidden}
  .hero::before{content:'';position:absolute;inset:0;pointer-events:none;
    background:url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")}
  .hero-eyebrow{color:${GOLD};font-size:12px;letter-spacing:3px;text-transform:uppercase;
    font-weight:600;margin-bottom:16px}
  .hero-title{font-size:clamp(28px,5vw,52px);font-weight:900;color:${WHITE};
    line-height:1.15;margin-bottom:20px}
  .hero-title span{color:${GOLD}}
  .hero-subtitle{color:rgba(255,255,255,0.85);font-size:clamp(15px,2vw,18px);
    max-width:640px;margin:0 auto 32px;line-height:1.8}
  .hero-ctas{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;position:relative;z-index:2}

  .btn{padding:13px 26px;border-radius:8px;border:none;cursor:pointer;
    font-size:15px;font-weight:700;transition:all .2s;display:inline-flex;align-items:center;gap:8px}
  .btn-gold{background:${GOLD};color:${GREEN_DARK}}
  .btn-gold:hover{background:#E8C96A;transform:translateY(-1px)}
  .btn-green{background:${GREEN};color:${WHITE}}
  .btn-green:hover{background:${GREEN_LIGHT}}
  .btn-outline{background:transparent;color:${WHITE};border:2px solid rgba(255,255,255,0.6)}
  .btn-outline:hover{background:rgba(255,255,255,0.1)}
  .btn-sm{padding:8px 16px;font-size:13px}
  .btn-danger{background:#FEE2E2;color:#991B1B;border:none}
  .btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}

  .stats-bar{background:${GOLD};padding:18px 24px;display:flex;
    justify-content:center;gap:40px;flex-wrap:wrap}
  .stat{text-align:center}
  .stat-num{font-size:22px;font-weight:900;color:${GREEN_DARK}}
  .stat-label{font-size:11px;color:${GREEN_DARK};font-weight:600;
    letter-spacing:.5px;text-transform:uppercase;margin-top:2px;opacity:.8}

  .section{padding:64px 24px;max-width:1100px;margin:0 auto}
  .section-eyebrow{color:${GREEN};font-size:11px;letter-spacing:3px;
    text-transform:uppercase;font-weight:700;margin-bottom:10px}
  .section-title{font-size:clamp(24px,3vw,36px);font-weight:900;
    color:${GREEN_DARK};margin-bottom:12px;line-height:1.2}

  .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));
    gap:20px;margin-top:36px}
  .step{background:${WHITE};border-radius:12px;padding:24px;
    border:1px solid #D4E8DC;position:relative;overflow:hidden}
  .step::before{content:'';position:absolute;top:0;left:0;
    width:4px;height:100%;background:${GREEN}}
  .step-num{font-size:40px;font-weight:900;color:#D4E8DC;line-height:1;margin-bottom:10px}
  .step-title{font-size:14px;font-weight:700;color:${GREEN_DARK};margin-bottom:6px}
  .step-body{font-size:12px;color:${MUTED};line-height:1.7}

  .form-wrap{background:${WHITE};border-radius:16px;padding:40px;max-width:700px;
    margin:0 auto;box-shadow:0 4px 32px rgba(15,69,38,0.1)}
  .form-title{font-size:26px;font-weight:900;color:${GREEN_DARK};margin-bottom:6px}
  .form-sub{color:${MUTED};font-size:14px;margin-bottom:28px;line-height:1.6}
  .form-group{margin-bottom:18px}
  .form-label{display:block;font-size:13px;font-weight:600;color:${GREEN_DARK};margin-bottom:5px}
  .form-label span{color:${ERROR}}
  .form-input{width:100%;padding:11px 14px;border:1.5px solid #D4E8DC;border-radius:8px;
    font-size:14px;color:#1a1a2e;background:${WHITE};transition:border-color .2s;font-family:inherit}
  .form-input:focus{outline:none;border-color:${GREEN}}
  .form-input.error{border-color:${ERROR}}
  .form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .form-select{width:100%;padding:11px 14px;border:1.5px solid #D4E8DC;border-radius:8px;
    font-size:14px;color:#1a1a2e;background:${WHITE};cursor:pointer;font-family:inherit}
  .form-select:focus{outline:none;border-color:${GREEN}}
  .error-text{color:${ERROR};font-size:12px;margin-top:4px}
  .section-divider{background:${WHITE};border-top:1px solid #D4E8DC;
    border-bottom:1px solid #D4E8DC;padding:8px 24px;font-size:11px;
    color:${GREEN};font-weight:700;text-transform:uppercase;letter-spacing:1px;margin:8px 0}

  .portal{max-width:960px;margin:0 auto;padding:32px 24px}
  .portal-header{background:linear-gradient(135deg,${GREEN_DARK},${GREEN});
    border-radius:16px;padding:28px;color:${WHITE};margin-bottom:24px;
    display:flex;justify-content:space-between;align-items:flex-start;
    flex-wrap:wrap;gap:16px}
  .portal-name{font-size:22px;font-weight:900}
  .portal-code{background:${GOLD};color:${GREEN_DARK};padding:4px 12px;
    border-radius:20px;font-size:12px;font-weight:700;display:inline-block;margin-top:6px}

  .tabs{display:flex;gap:4px;background:#D4E8DC;border-radius:10px;
    padding:4px;margin-bottom:24px;flex-wrap:wrap}
  .tab{flex:1;padding:10px;border-radius:7px;border:none;cursor:pointer;
    font-size:13px;font-weight:600;color:${MUTED};background:transparent;
    transition:all .2s;min-width:90px;text-align:center}
  .tab.active{background:${WHITE};color:${GREEN_DARK};
    box-shadow:0 1px 6px rgba(15,69,38,0.12)}

  .info-card{background:${WHITE};border-radius:12px;padding:20px;
    box-shadow:0 2px 12px rgba(15,69,38,0.07);border:1px solid #D4E8DC}
  .info-card-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;
    color:${MUTED};font-weight:700;margin-bottom:6px}
  .info-card-value{font-size:24px;font-weight:900;color:${GREEN_DARK}}
  .info-card-sub{font-size:12px;color:${MUTED};margin-top:4px}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
  .grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px}
  .grid-4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-bottom:20px}

  .balance-card{background:linear-gradient(135deg,${GREEN_DARK},${GREEN});
    border-radius:14px;padding:28px;color:${WHITE};margin-bottom:20px}
  .balance-label{font-size:12px;letter-spacing:2px;text-transform:uppercase;
    color:rgba(255,255,255,0.7);margin-bottom:8px}
  .balance-amount{font-size:48px;font-weight:900;line-height:1}
  .balance-ngn{font-size:16px;color:rgba(255,255,255,0.7);margin-top:6px}

  .credit-item{background:${WHITE};border-radius:10px;padding:16px;
    margin-bottom:10px;border:1px solid #D4E8DC;
    display:flex;justify-content:space-between;align-items:center}
  .credit-type-badge{display:inline-block;padding:3px 10px;border-radius:12px;
    font-size:11px;font-weight:700}
  .badge-direct{background:#DCFCE7;color:#166534}
  .badge-indirect1{background:#DBEAFE;color:#1E40AF}
  .badge-indirect2{background:#F3E8FF;color:#6B21A8}
  .badge-reactivation{background:#FEF9C3;color:#854D0E}

  .outreach-card{background:linear-gradient(135deg,${GREEN_DARK},${GREEN});
    border-radius:14px;padding:24px;color:${WHITE};margin-bottom:20px}
  .outreach-link-box{background:rgba(255,255,255,0.1);border-radius:8px;
    padding:12px 16px;display:flex;align-items:center;gap:12px;
    margin-top:12px;word-break:break-all}

  .progress-bar{height:12px;background:rgba(255,255,255,0.2);
    border-radius:6px;overflow:hidden;margin:10px 0}
  .progress-fill{height:100%;background:${GOLD};border-radius:6px;transition:width .5s}

  .payment-options{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0}
  .pay-option{border:2px solid #D4E8DC;border-radius:12px;padding:20px;
    cursor:pointer;transition:all .2s;text-align:center}
  .pay-option:hover,.pay-option.active{border-color:${GREEN};background:#F0F6F2}
  .pay-option-title{font-size:14px;font-weight:700;color:${GREEN_DARK}}
  .pay-option-sub{font-size:12px;color:${MUTED};margin-top:4px}

  .bank-details{background:${GOLD_BG};border:1px solid ${GOLD};
    border-radius:10px;padding:20px;margin:16px 0}
  .bank-row{display:flex;justify-content:space-between;padding:8px 0;
    border-bottom:1px solid rgba(201,168,76,0.3);font-size:14px}
  .bank-row:last-child{border-bottom:none}
  .copy-btn{background:${GREEN};color:${WHITE};border:none;padding:3px 10px;
    border-radius:4px;font-size:11px;cursor:pointer;margin-left:8px}

  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);
    z-index:200;display:flex;align-items:center;justify-content:center;padding:20px}
  .modal{background:${WHITE};border-radius:16px;padding:32px;max-width:520px;
    width:100%;max-height:90vh;overflow-y:auto}
  .modal-title{font-size:22px;font-weight:900;color:${GREEN_DARK};margin-bottom:6px}
  .modal-sub{font-size:14px;color:${MUTED};margin-bottom:24px;line-height:1.6}

  .alert{border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.6;margin-bottom:16px}
  .alert-success{background:#F0FFF4;border:1px solid #86EFAC;color:${SUCCESS}}
  .alert-error{background:#FFF1F2;border:1px solid #FDA4AF;color:#9F1239}
  .alert-info{background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF}
  .alert-gold{background:${GOLD_BG};border:2px solid ${GOLD};color:${GREEN_DARK}}
  .alert-warning{background:#FFFBEB;border:1px solid #FCD34D;color:#92400E}

  .table-wrap{background:${WHITE};border-radius:12px;overflow:hidden;
    box-shadow:0 2px 12px rgba(15,69,38,0.07);margin-bottom:24px;border:1px solid #D4E8DC}
  .table-head{background:${GREEN_DARK};padding:14px 20px;display:grid;gap:12px;
    font-size:11px;font-weight:700;color:rgba(255,255,255,0.85);
    text-transform:uppercase;letter-spacing:.5px}
  .table-row{padding:14px 20px;display:grid;gap:12px;
    border-bottom:1px solid #F0F6F2;font-size:13px;align-items:center}
  .table-row:last-child{border-bottom:none}
  .table-row:hover{background:#F8FBF9}

  .status-pill{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700}
  .pill-pending{background:#FEF9C3;color:#854D0E}
  .pill-active{background:#DCFCE7;color:#166534}
  .pill-expired{background:#FEE2E2;color:#991B1B}
  .pill-processed{background:#DBEAFE;color:#1E40AF}

  .admin-stat{background:${WHITE};border-radius:10px;padding:16px;
    border-left:4px solid ${GREEN};border:1px solid #D4E8DC}
  .admin-stat-val{font-size:26px;font-weight:900;color:${GREEN_DARK}}
  .admin-stat-label{font-size:11px;color:${MUTED};margin-top:4px;font-weight:600;
    text-transform:uppercase;letter-spacing:.5px}

  .illus-box{background:${GOLD_BG};border:2px solid ${GOLD};border-radius:16px;padding:32px;margin-top:32px}
  .illus-step{display:flex;gap:16px;margin-bottom:20px;align-items:flex-start}
  .illus-badge{background:${GREEN};color:${WHITE};font-weight:900;font-size:13px;
    width:36px;height:36px;border-radius:50%;display:flex;align-items:center;
    justify-content:center;flex-shrink:0;min-width:36px}
  .illus-text{font-size:14px;color:${GREEN_DARK};line-height:1.8}
  .illus-highlight{background:${WHITE};border-radius:8px;padding:12px 16px;
    margin-top:8px;font-size:13px;color:${SUCCESS};font-weight:700;
    border:1px solid #86EFAC}

  .footer{background:${GREEN_DARK};color:rgba(255,255,255,0.7);
    padding:40px 24px;text-align:center}
  .footer-logo{font-size:18px;font-weight:900;color:${WHITE};margin-bottom:8px}
  .footer-sub{font-size:13px;margin-bottom:20px}
  .footer-links{display:flex;gap:20px;justify-content:center;flex-wrap:wrap;margin-bottom:20px}
  .footer-link{color:${GOLD};font-size:13px;cursor:pointer;background:none;border:none}
  .footer-copy{font-size:12px;color:rgba(255,255,255,0.4)}

  @media(max-width:640px){
    .form-row{grid-template-columns:1fr}
    .grid-2{grid-template-columns:1fr}
    .grid-3{grid-template-columns:1fr}
    .grid-4{grid-template-columns:1fr 1fr}
    .payment-options{grid-template-columns:1fr}
    .hero{padding:48px 20px 40px}
    .portal-header{flex-direction:column}
    .nav-links{gap:4px}
    .nav-btn{padding:6px 10px;font-size:12px}
    .balance-amount{font-size:36px}
  }
`;

// ── MAIN APP ──────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("landing");
  const [applicants, setApplicants] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [modal, setModal] = useState(null);
  const [portalTab, setPortalTab] = useState("overview");
  const [adminTab, setAdminTab] = useState("applicants");
  const [loginCode, setLoginCode] = useState("");
  const [payMethod, setPayMethod] = useState("online");
  const [pendingCode, setPendingCode] = useState(null);
  const [refUrl, setRefUrl] = useState("");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordError, setAdminPasswordError] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [myCredits, setMyCredits] = useState([]);
  const [myWithdrawals, setMyWithdrawals] = useState([]);
  const [allWithdrawals, setAllWithdrawals] = useState([]);
  const [tcAgreed, setTcAgreed] = useState(false);
  const [idFile, setIdFile] = useState(null);
  const [region, setRegion] = useState("africa");
  const [stripeElements, setStripeElements] = useState(null);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeError, setStripeError] = useState(null);
  const [stripeClientSecret, setStripeClientSecret] = useState(null);
  const [isReactivationPay, setIsReactivationPay] = useState(false);
  const [regErrors, setRegErrors] = useState({});
  const [regForm, setRegForm] = useState({
    fullName:"", email:"", phone:"", country:"Nigeria",
    institution:"", course:"", level:"100 Level",
    accountName:"", accountNumber:"", accountBank:"", accountCountry:"Nigeria",
    referredBy:"",
  });



  useEffect(() => {
    (async () => {
      try {
        const a = await DB.getApplicants();
        setApplicants(a);
        const u = DB.getCurrentUser();
        if (u && a[u]) {
          setCurrentUser(u);
          setView("portal");
          const [credits, withdrawals] = await Promise.all([
            DB.getCredits(u), DB.getWithdrawals(u)
          ]);
          setMyCredits(credits);
          setMyWithdrawals(withdrawals);
        }
        const params = new URLSearchParams(window.location.search);
        const ref = params.get("ref");
        const loginCode = params.get("login");
        const stripePaid = params.get("stripe_paid");
        const stripeType = params.get("type");

        if (ref) { setRefUrl(ref); setRegForm(p => ({...p, referredBy: ref})); }

        // Handle return from Stripe Payment Link
        if (loginCode && stripePaid === "1" && a[loginCode]) {
          if (stripeType === "reactivation") {
            await DB.reactivateLink(loginCode);
            const freshA = await DB.getApplicants();
            setApplicants(freshA);
            DB.setCurrentUser(loginCode);
            setCurrentUser(loginCode);
            const [credits, withdrawals] = await Promise.all([
              DB.getCredits(loginCode), DB.getWithdrawals(loginCode)
            ]);
            setMyCredits(credits); setMyWithdrawals(withdrawals);
            setView("portal"); setPortalTab("outreach");
            showAlert("Outreach link reactivated! Your new USD 1,000 cycle has started.");
          } else {
            await completeActivation(loginCode, "stripe", "stripe-link-" + Date.now());
          }
          window.history.replaceState({}, "", window.location.pathname);
        }


      } catch(err) { console.error("Load error:", err); }
      setLoading(false);
    })();
  }, []);

  const showAlert = useCallback((msg, type="success") => {
    setAlert({msg,type}); setTimeout(()=>setAlert(null),6000);
  }, []);

  const validateReg = () => {
    const errs = {};
    if (!regForm.fullName.trim()) errs.fullName = "Full name is required";
    if (!regForm.email.includes("@")) errs.email = "Valid email required";
    if (regForm.phone.length < 10) errs.phone = "Valid phone required";
    if (!regForm.institution.trim()) errs.institution = "Institution is required";
    if (!regForm.course.trim()) errs.course = "Course of study is required";
    if (!regForm.accountName.trim()) errs.accountName = "Account name is required";
    if (!regForm.accountNumber.trim()) errs.accountNumber = "Account number is required";
    if (!regForm.accountBank.trim()) errs.accountBank = "Bank name is required";
    if (!tcAgreed) errs.tcAgreed = "You must agree to the Terms & Conditions";
    if (!idFile) errs.idFile = "Please upload a scan copy of your valid school ID card";
    return errs;
  };

  const handleApply = async () => {
    const errs = validateReg();
    if (Object.keys(errs).length) { setRegErrors(errs); return; }

    const { data: existing } = await supabase.from("aosf_applicants")
      .select("ref_code").eq("email", regForm.email.toLowerCase().trim()).limit(1);
    if (existing && existing[0]) {
      showAlert("An account with this email already exists. Please log in instead.", "error");
      return;
    }

    const code = generateCode(regForm.fullName, regForm.country);
    const applicant = { ...regForm, email: regForm.email.toLowerCase().trim() };

    try {
      await DB.insertApplicant(code, applicant);
    } catch(err) {
      showAlert("Application failed: " + err.message, "error"); return;
    }

    const freshApplicants = await DB.getApplicants();
    setApplicants(freshApplicants);
    DB.setCurrentUser(code);
    setCurrentUser(code);
    setPendingCode(code);

    // Send welcome email immediately
    await sendEmail({
      to_email: "outreachscholarshipadmin@gmail.com", to_name: "AOSF Admin",
      subject: "AOSP — Forward to Applicant: " + regForm.fullName + " | " + regForm.email + " | Ref: " + code,
      message: "Dear " + regForm.fullName + "," +
        "\n\nWelcome to the African Outreach Scholarship Program (AOSP)!" +
        "\n\nYour application has been received. Please save your login details below." +
        "\n\n--- YOUR LOGIN DETAILS ---" +
        "\nPlatform: https://aosf-platform.vercel.app" +
        "\nReference Code: " + code +
        "\nTo log in: Click LOG IN on the platform and enter your reference code." +
        "\n\n--- YOUR APPLICATION DETAILS ---" +
        "\nFull Name: " + regForm.fullName +
        "\nEmail: " + regForm.email +
        "\nPhone: " + regForm.phone +
        "\nCountry: " + regForm.country +
        "\nInstitution: " + regForm.institution +
        "\nCourse: " + regForm.course + " — " + regForm.level +
        "\nOutreach From: " + (regForm.referredBy || "Direct Application") +
        "\nDate: " + new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"}) +
        "\n\n--- BANK ACCOUNT FOR CASHOUT ---" +
        "\nAccount Name: " + regForm.accountName +
        "\nAccount Number: " + regForm.accountNumber +
        "\nBank: " + regForm.accountBank + " (" + regForm.accountCountry + ")" +
        "\n\n--- NEXT STEP ---" +
        "\nLog in and make a USD 5.00 scholarship donation to activate your outreach link." +
        "\nBank Transfer: RoyalTech Partnership & Investment Limited | 1016621205 | Zenith Bank" +
        "\nReference: " + code +
        "\nSend proof to WhatsApp: 09099994816" +
        "\n\nBest regards," +
        "\nAfrican Outreach Scholarship Foundation" +
        "\nPowered by RoyalTech Partnership & Investment Limited" +
        "\nPhone: +234 806 163 1222 | aosf2026@gmail.com",
    });

    // Notify admin
    await sendEmail({
      to_email: ADMIN_EMAIL, to_name: "AOSF Admin",
      subject: "AOSP — New Application (Donation Pending): " + regForm.fullName + " (" + regForm.email + ")",
      message: [
        "New scholarship application received.",
        "--- APPLICANT DETAILS ---",
        "Full Name: " + regForm.fullName,
        "Reference Code: " + code,
        "Email: " + regForm.email,
        "Phone: " + regForm.phone,
        "Country: " + regForm.country,
        "Institution: " + regForm.institution,
        "Course: " + regForm.course + " — " + regForm.level,
        "Outreach From: " + (regForm.referredBy || "Direct"),
        "Scholarship Donation: USD " + APP_FEE_USD + " — PENDING",
        "--- BANK ACCOUNT ---",
        "Account Name: " + regForm.accountName,
        "Account Number: " + regForm.accountNumber,
        "Bank: " + regForm.accountBank + " (" + regForm.accountCountry + ")",
        "Application Date: " + new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"}),
        "School ID: Uploaded (" + (idFile?idFile.name:"none") + ")",
      ].join("\n"),
    });

    setView("portal");
    setPortalTab("overview");
    showAlert("Application submitted! Check your email for your reference code. Complete your USD 5 fee to activate your outreach link.");
  };

  const handleStripePay = (isReactivation = false) => {
    const code = pendingCode || currentUser;
    const applicant = applicants[code];
    if (!applicant) return;
    const selectedRegion = REGIONS[region] || REGIONS.africa;
    const currency = selectedRegion.currency;
    const amount = fromUSD(APP_FEE_USD, currency).toFixed(2);
    const link = isReactivation ? STRIPE_REACTIVATION_LINK : STRIPE_PAYMENT_LINK;
    // Append reference code and return URL as query params
    const returnUrl = encodeURIComponent(
      window.location.origin + "?login=" + code + "&stripe_paid=1&type=" +
      (isReactivation ? "reactivation" : "fee")
    );
    const stripeUrl = link + "?client_reference_id=" + code +
      "&success_url=" + returnUrl;
    showAlert("Redirecting to Stripe secure payment (" + currency + " " + amount + ")...", "info");
    setTimeout(() => { window.location.href = stripeUrl; }, 1200);
  };


  const handlePaystackPay = (isReactivation = false) => {
    const code = pendingCode || currentUser;
    const applicant = applicants[code];
    if (!applicant) return;
    if (!window || typeof window.PaystackPop === "undefined") {
      showAlert("Paystack is loading. Please try again.", "error"); return;
    }
    const amountNGN = Math.round(APP_FEE_USD * USD_TO_NGN);
    const handler = window.PaystackPop.setup({
      key: PAYSTACK_PUBLIC_KEY,
      email: applicant.email,
      amount: amountNGN * 100,
      currency: "NGN",
      ref: "AOSP-" + (isReactivation?"REACT":"FEE") + "-" + code + "-" + Date.now(),
      metadata: { aosf_code: code, type: isReactivation ? "reactivation" : "application_fee" },
      callback: async (response) => {
        if (isReactivation) {
          await completeReactivation(code);
        } else {
          await completeActivation(code, "paystack", response.reference);
        }
      },
      onClose: () => showAlert("Payment window closed.", "info"),
    });
    handler.openIframe();
  };

  const completeActivation = async (code, method, payRef) => {
    await DB.activateApplicant(code);
    const freshApplicants = await DB.getApplicants();
    setApplicants(freshApplicants);
    const applicant = freshApplicants[code];

    // Credit referrers
    if (applicant.referredBy && freshApplicants[applicant.referredBy]) {
      const direct = freshApplicants[applicant.referredBy];
      if (direct.linkActive) {
        const newLinkEarned = await DB.creditApplicant(applicant.referredBy, DIRECT_CREDIT, "direct");
        // Notify direct referrer
        await sendEmail({
          to_email: direct.email, to_name: direct.fullName,
          subject: "AOSP — USD 1.00 Direct Outreach Credit Earned!",
          message: [
            "Dear " + direct.fullName + ",",
            "Great news! A student applied through your outreach link.",
            "--- CREDIT EARNED ---",
            "Type: Direct Outreach Credit",
            "Amount: USD 1.00",
            "New Applicant: " + applicant.fullName + " (" + applicant.institution + ", " + applicant.country + ")",
            "Your Scholarship Balance: USD " + (Number(direct.balance) + 1).toFixed(2),
            "Outreach Progress: USD " + newLinkEarned.toFixed(2) + " / USD " + LINK_CAP + " (link cap)",
            newLinkEarned >= LINK_CAP
              ? "⚠️ Your outreach link has reached the USD 1,000 cap and is now INACTIVE. Make a new USD 5.00 donation to reactivate your link."
              : "Keep sharing your link to grow your scholarship funds!",
            "Log in: https://aosf-platform.vercel.app | Code: " + applicant.referredBy,
            "Best regards,\nAfrican Outreach Scholarship Program\nPowered by African Outreach Scholarship Foundation",
          ].join("\n"),
        });

        // 1st extension indirect credit
        if (direct.referredBy && freshApplicants[direct.referredBy]) {
          const indirect1 = freshApplicants[direct.referredBy];
          if (indirect1.linkActive) {
            const newLink1 = await DB.creditApplicant(direct.referredBy, INDIRECT1_CREDIT, "indirect_1");
            await sendEmail({
              to_email: indirect1.email, to_name: indirect1.fullName,
              subject: "AOSP — USD 1.00 Indirect Outreach Credit (1st Extension)!",
              message: [
                "Dear " + indirect1.fullName + ",",
                "A student applied through the outreach link of someone through your outreach link.",
                "--- INDIRECT CREDIT (1st Extension) ---",
                "Type: 1st Extension Indirect Credit",
                "Amount: USD 1.00",
                "New Applicant: " + applicant.fullName + " (" + applicant.institution + ", " + applicant.country + ")",
                "Via: " + direct.fullName + " (your direct outreach)",
                "Your Scholarship Balance: USD " + (Number(indirect1.balance) + 1).toFixed(2),
                newLink1 >= LINK_CAP
                  ? "⚠️ Your outreach link has reached the USD 1,000 cap. Make a new USD 5.00 donation to reactivate your link."
                  : "Your extended outreach keeps building your scholarship funds!",
                "Log in: https://aosf-platform.vercel.app | Code: " + direct.referredBy,
                "Best regards,\nAfrican Outreach Scholarship Program\nPowered by African Outreach Scholarship Foundation",
              ].join("\n"),
            });

            // 2nd extension indirect credit
            if (indirect1.referredBy && freshApplicants[indirect1.referredBy]) {
              const indirect2 = freshApplicants[indirect1.referredBy];
              if (indirect2.linkActive) {
                const newLink2 = await DB.creditApplicant(indirect1.referredBy, INDIRECT2_CREDIT, "indirect_2");
                await sendEmail({
                  to_email: indirect2.email, to_name: indirect2.fullName,
                  subject: "AOSP — USD 1.00 Indirect Outreach Credit (2nd Extension)!",
                  message: [
                    "Dear " + indirect2.fullName + ",",
                    "A student you have never met just generated a scholarship credit in your account.",
                    "--- INDIRECT CREDIT (2nd Extension) ---",
                    "Type: 2nd Extension Indirect Credit",
                    "Amount: USD 1.00",
                    "New Applicant: " + applicant.fullName + " (" + applicant.institution + ", " + applicant.country + ")",
                    "Chain: " + indirect2.fullName + " → " + indirect1.fullName + " → " + direct.fullName + " → " + applicant.fullName,
                    "Your Scholarship Balance: USD " + (Number(indirect2.balance) + 1).toFixed(2),
                    newLink2 >= LINK_CAP
                      ? "⚠️ Your outreach link has reached the USD 1,000 cap. Make a new USD 5.00 donation to reactivate your link."
                      : "This is the power of outreach — your extended links keep funding your education!",
                    "Log in: https://aosf-platform.vercel.app | Code: " + indirect1.referredBy,
                    "Best regards,\nAfrican Outreach Scholarship Program\nPowered by African Outreach Scholarship Foundation",
                  ].join("\n"),
                });
              }
            }
          }
        }
      }
    }

    // Admin notification
    await sendEmail({
      to_email: ADMIN_EMAIL, to_name: "AOSF Admin",
      subject: "AOSP — Scholarship Donation Confirmed: " + applicant.fullName,
      message: [
        "Scholarship donation confirmed for: " + applicant.fullName,
        "Code: " + code + " | Country: " + applicant.country,
        "Institution: " + applicant.institution,
        "Donation: USD " + APP_FEE_USD + " via " + method,
        "Outreach From: " + (applicant.referredBy || "Direct"),
        "Outreach link is now ACTIVE.",
      ].join("\n"),
    });

    // Send outreach materials email to outreachscholarshipadmin for forwarding
    const outreachLink = "https://aosf-platform.vercel.app?ref=" + code;
    await sendEmail({
      to_email: "outreachscholarshipadmin@gmail.com",
      to_name: "AOSF Admin",
      subject: "AOSP — Forward to: " + applicant.fullName + " | " + applicant.email,
      message: "Dear " + applicant.fullName + "," +
        "\n\nCongratulations! Your AOSP scholarship account is now ACTIVE." +
        "\n\n--- YOUR OUTREACH DETAILS ---" +
        "\nReference Code: " + code +
        "\nOutreach Link: " + outreachLink +
        "\nInstitution: " + applicant.institution +
        "\nCountry: " + applicant.country +
        "\n\n--- NEXT STEP ---" +
        "\nLog in to your AOSP portal to access your outreach materials and all four regional ad templates ready for sharing:" +
        "\nPlatform: https://aosf-platform.vercel.app" +
        "\nReference Code: " + code +
        "\n\nShare your outreach link widely across Africa, Canada, USA and UK to start receiving donated scholarship funds." +
        "\n\nBest regards," +
        "\nAfrican Outreach Scholarship Program (AOSP)" +
        "\nPowered by African Outreach Scholarship Foundation" +
        "\nEmail: aosf2026@gmail.com | WhatsApp: +234 909 999 4816",
    });

    const [credits, withdrawals] = await Promise.all([DB.getCredits(code), DB.getWithdrawals(code)]);
    setMyCredits(credits); setMyWithdrawals(withdrawals);
    setPortalTab("overview");
    showAlert("Scholarship donation confirmed! Your outreach link is now active. Start sharing your outreach link!");
  };

  const completeReactivation = async (code) => {
    await DB.reactivateLink(code);
    const freshApplicants = await DB.getApplicants();
    setApplicants(freshApplicants);
    setModal(null);
    showAlert("Outreach link reactivated! Your new USD 1,000 earning cycle has started.");
    await sendEmail({
      to_email: freshApplicants[code]?.email, to_name: freshApplicants[code]?.fullName,
      subject: "AOSP — Outreach Link Reactivated! New Cycle Begins",
      message: [
        "Dear " + freshApplicants[code]?.fullName + ",",
        "Your AOSP outreach link has been successfully reactivated.",
        "A new USD 1,000 donation cycle has started.",
        "Your scholarship balance and previous earnings remain intact.",
        "Your Outreach Link: https://aosf-platform.vercel.app?ref=" + code,
        "Share widely and keep earning scholarship funds!",
        "Log in: https://aosf-platform.vercel.app | Code: " + code,
        "Best regards,\nAfrican Outreach Scholarship Program\nPowered by African Outreach Scholarship Foundation",
      ].join("\n"),
    });
  };

  const handleWithdraw = async () => {
    const applicant = applicants[currentUser];
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt < 50) { showAlert("Minimum withdrawal is USD 50.00", "error"); return; }
    if (amt > applicant.balance) { showAlert("Insufficient balance.", "error"); return; }
    await DB.requestWithdrawal(currentUser, amt);
    const freshApplicants = await DB.getApplicants();
    setApplicants(freshApplicants);
    const freshWithdrawals = await DB.getWithdrawals(currentUser);
    setMyWithdrawals(freshWithdrawals);
    setModal(null); setWithdrawAmount("");
    showAlert("Withdrawal request submitted. RoyalTech will process within 24 hours.");
    await sendEmail({
      to_email: applicant.email, to_name: applicant.fullName,
      subject: "AOSP — Withdrawal Request Received: USD " + amt.toFixed(2),
      message: [
        "Dear " + applicant.fullName + ",",
        "Your withdrawal request has been received.",
        "Amount: USD " + amt.toFixed(2) + " (approx. " + fmtNGN(amt) + ")",
        "Account: " + applicant.accountName + " | " + applicant.accountNumber + " | " + applicant.accountBank + " (" + applicant.accountCountry + ")",
        "RoyalTech will process your withdrawal within 24 hours.",
        "Reference Code: " + currentUser,
        "Best regards,\nAfrican Outreach Scholarship Program\nPowered by African Outreach Scholarship Foundation",
      ].join("\n"),
    });
    await sendEmail({
      to_email: ADMIN_EMAIL, to_name: "AOSF Admin",
      subject: "AOSP — Withdrawal Request: " + applicant.fullName + " USD " + amt.toFixed(2),
      message: [
        "Withdrawal request received.",
        "Applicant: " + applicant.fullName + " (" + currentUser + ")",
        "Amount: USD " + amt.toFixed(2) + " (approx. " + fmtNGN(amt) + ")",
        "Pay to: " + applicant.accountName,
        "Account: " + applicant.accountNumber,
        "Bank: " + applicant.accountBank + " (" + applicant.accountCountry + ")",
        "Email: " + applicant.email,
        "Phone: " + applicant.phone,
        "ACTION: Process within 24 hours.",
      ].join("\n"),
    });
  };

  const handleLogin = async () => {
    const code = loginCode.trim().toUpperCase();
    const freshApplicants = await DB.getApplicants();
    if (freshApplicants[code]) {
      setApplicants(freshApplicants);
      DB.setCurrentUser(code); setCurrentUser(code);
      setModal(null); setView("portal");
      const [credits, withdrawals] = await Promise.all([DB.getCredits(code), DB.getWithdrawals(code)]);
      setMyCredits(credits); setMyWithdrawals(withdrawals);
    } else {
      showAlert("Reference code not found. Please check and try again.", "error");
    }
  };

  const logout = () => { DB.clearCurrentUser(); setCurrentUser(null); setView("landing"); };

  if (loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      height:"100vh",background:BG,flexDirection:"column",gap:12}}>
      <div style={{fontSize:28,fontWeight:900,color:GREEN}}>AOSF</div>
      <div style={{fontSize:14,color:MUTED}}>Loading Scholarship Platform...</div>
    </div>
  );

  const applicant = currentUser ? applicants[currentUser] : null;
  const outreachLink = currentUser ? (window.location.origin + "?ref=" + currentUser) : "";
  const linkPct = applicant ? Math.min(100, Math.round((applicant.linkEarned / LINK_CAP) * 100)) : 0;

  return (
    <div className="app">
      <style>{css}</style>

      {alert && (
        <div style={{position:"fixed",top:80,right:20,zIndex:300,maxWidth:400}}>
          <div className={"alert alert-"+alert.type}>{alert.msg}</div>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={()=>setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>

            {modal==="login" && (
              <>
                <div className="modal-title">Log In to Your Portal</div>
                <div className="modal-sub">Enter your AOSP reference code to access your scholarship dashboard.</div>
                <div className="form-group">
                  <label className="form-label">Reference Code <span>*</span></label>
                  <input className="form-input" placeholder="e.g. AOSP-JOD-NG-X3K9"
                    value={loginCode} onChange={e=>setLoginCode(e.target.value.toUpperCase())}
                    onKeyDown={e=>e.key==="Enter"&&handleLogin()}/>
                </div>
                <button className="btn btn-green" style={{width:"100%"}} onClick={handleLogin}>
                  Access My Scholarship Portal
                </button>
                <div style={{textAlign:"center",marginTop:12,fontSize:13,color:MUTED}}>
                  No account yet?{" "}
                  <button style={{background:"none",border:"none",color:GREEN,cursor:"pointer",fontWeight:700,fontSize:13}}
                    onClick={()=>{setModal(null);setView("apply");}}>Apply here</button>
                </div>
              </>
            )}

            {modal==="admin_login" && (
              <>
                <div className="modal-title">Admin Access</div>
                <div className="modal-sub">Enter the admin password to access the dashboard.</div>
                <div className="form-group">
                  <label className="form-label">Password</label>
                  <input className={"form-input"+(adminPasswordError?" error":"")}
                    type="password" placeholder="Admin password"
                    value={adminPassword}
                    onChange={e=>{setAdminPassword(e.target.value);setAdminPasswordError(false);}}
                    onKeyDown={e=>{if(e.key==="Enter"){
                      if(adminPassword===ADMIN_PASSWORD){setAdminUnlocked(true);setModal(null);setAdminPassword("");setView("admin");}
                      else setAdminPasswordError(true);
                    }}}/>
                  {adminPasswordError&&<div className="error-text">Incorrect password.</div>}
                </div>
                <button className="btn btn-green" style={{width:"100%"}}
                  onClick={()=>{
                    if(adminPassword===ADMIN_PASSWORD){setAdminUnlocked(true);setModal(null);setAdminPassword("");setView("admin");}
                    else setAdminPasswordError(true);
                  }}>Access Admin Dashboard</button>
              </>
            )}

            {modal==="withdraw" && applicant && (
              <>
                <div className="modal-title">Cash Out Scholarship Funds</div>
                <div className="modal-sub">Funds will be sent to your registered bank account within 24 hours.</div>
                <div style={{background:GOLD_BG,border:"1px solid "+GOLD,borderRadius:10,padding:16,marginBottom:20}}>
                  {[["Available Balance",fmtUSD(applicant.balance)+" (approx. "+fmtNGN(applicant.balance)+")"],
                    ["Account Name",applicant.accountName],
                    ["Account Number",applicant.accountNumber],
                    ["Bank",applicant.accountBank],
                    ["Country",applicant.accountCountry],
                  ].map(([k,v])=>(
                    <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",
                      borderBottom:"1px solid rgba(201,168,76,0.3)",fontSize:13}}>
                      <span style={{color:MUTED}}>{k}</span>
                      <span style={{fontWeight:700,color:GREEN_DARK}}>{v}</span>
                    </div>
                  ))}
                </div>
                <div className="form-group">
                  <label className="form-label">Amount to Withdraw (USD) <span>*</span></label>
                  <input className="form-input" type="number" placeholder="e.g. 50"
                    value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)}/>
                  {withdrawAmount && Number(withdrawAmount) > 0 && (
                    <div style={{fontSize:12,color:MUTED,marginTop:4}}>
                      ≈ {fmtNGN(Number(withdrawAmount))} at current rate
                    </div>
                  )}
                </div>
                <button className="btn btn-green" style={{width:"100%"}} onClick={handleWithdraw}>
                  Submit Withdrawal Request
                </button>
              </>
            )}

            {modal==="stripe_pay" && (
              <>
                <div className="modal-title">Complete Your Payment</div>
                <div className="modal-sub">
                  Enter your card details to complete the{" "}
                  {isReactivationPay ? "reactivation" : "application"} fee payment of{" "}
                  {REGIONS[region]?.currency} {fromUSD(APP_FEE_USD, REGIONS[region]?.currency||"USD").toFixed(2)}
                  {" "}(≈ USD {APP_FEE_USD}).
                </div>

                <div style={{background:"#F8FBF9",borderRadius:10,padding:20,marginBottom:20}}>
                  <div id="stripe-payment-element" style={{minHeight:200}}>
                    <div style={{textAlign:"center",padding:32,color:MUTED}}>
                      <div style={{fontSize:32,marginBottom:12}}>💳</div>
                      <div style={{fontWeight:700,color:GREEN_DARK,marginBottom:8}}>Stripe Card Payment</div>
                      <div style={{fontSize:13,lineHeight:1.7}}>
                        Your payment is secured by Stripe. Enter your card details below.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="alert alert-gold" style={{fontSize:13,marginBottom:16}}>
                  After clicking Pay Now, Stripe will process your payment securely.
                  Your outreach link will activate immediately upon confirmation.
                </div>

                <div style={{display:"flex",gap:12}}>
                  <button className="btn btn-green" style={{flex:1}}
                    disabled={stripeLoading}
                    onClick={confirmStripePayment}>
                    {stripeLoading ? "Processing..." : "Pay Now — " + (REGIONS[region]?.currency||"USD") + " " + fromUSD(APP_FEE_USD, REGIONS[region]?.currency||"USD").toFixed(2)}
                  </button>
                  <button className="btn" style={{background:"#F0F6F2",color:GREEN_DARK}}
                    onClick={()=>setModal(null)}>Cancel</button>
                </div>

                <div style={{textAlign:"center",marginTop:16,fontSize:12,color:MUTED}}>
                  🔒 Secured by Stripe — your card details are never stored on our servers
                </div>
              </>
            )}

            {modal==="reactivate" && applicant && (
              <>
                <div className="modal-title">Reactivate Your Outreach Link</div>
                <div className="modal-sub">
                  Your outreach link has earned USD {applicant.linkEarned.toFixed(2)} and reached the USD {LINK_CAP} cap.
                  Make a new donation of USD {APP_FEE_USD} to reactivate your link after receiving USD 1,000 from donated funds. Your existing balance remains intact.
                </div>
                <div style={{background:GOLD_BG,border:"1px solid "+GOLD,borderRadius:10,padding:16,marginBottom:20,fontSize:14}}>
                  {[["New Donation","USD "+APP_FEE_USD+".00 (≈ "+fmtNGN(APP_FEE_USD)+")"],
                    ["Your Current Balance",fmtUSD(applicant.balance)],
                    ["Total Earned All Cycles",fmtUSD(applicant.totalEarned)],
                    ["Cycle",applicant.linkCycle+" → "+(applicant.linkCycle+1)],
                  ].map(([k,v])=>(
                    <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",
                      borderBottom:"1px solid rgba(201,168,76,0.3)",fontSize:13}}>
                      <span style={{color:MUTED}}>{k}</span>
                      <span style={{fontWeight:700,color:GREEN_DARK}}>{v}</span>
                    </div>
                  ))}
                </div>
                <div className="payment-options">
                  <div className={"pay-option"+(payMethod==="online"?" active":"")} onClick={()=>setPayMethod("online")}>
                    <div style={{fontSize:28,marginBottom:6}}>💳</div>
                    <div className="pay-option-title">Pay Online</div>
                    <div className="pay-option-sub">
                      {region==="africa"?"Paystack":"Stripe"}
                    </div>
                  </div>
                  <div className={"pay-option"+(payMethod==="bank"?" active":"")} onClick={()=>setPayMethod("bank")}>
                    <div style={{fontSize:28,marginBottom:6}}>🏦</div>
                    <div className="pay-option-title">Bank Transfer</div>
                    <div className="pay-option-sub">Then notify via WhatsApp</div>
                  </div>
                </div>
                {payMethod==="bank" && (
                  <div className="bank-details">
                    <div style={{fontWeight:700,color:GREEN_DARK,marginBottom:10}}>
                      Transfer {fmtNGN(APP_FEE_USD)} (≈ USD {APP_FEE_USD}) to:
                    </div>
                    {[["Account Name","RoyalTech Partnership & Investment Limited"],
                      ["Account Number","1016621205"],["Bank","Zenith Bank"],
                      ["Reference",currentUser+"-REACT"],
                    ].map(([k,v])=>(
                      <div className="bank-row" key={k}>
                        <span style={{color:MUTED}}>{k}</span>
                        <span style={{fontWeight:700,color:GREEN_DARK}}>{v}
                          {k==="Account Number"&&<button className="copy-btn"
                            onClick={()=>{navigator.clipboard?.writeText(v);showAlert("Copied!");}}>Copy</button>}
                        </span>
                      </div>
                    ))}
                    <div style={{marginTop:12,fontSize:13,color:"#92400E",background:"#FFFBEB",
                      borderRadius:8,padding:"10px 14px"}}>
                      After transfer, send proof to WhatsApp: <strong>09099994816</strong>.<br/>
                      Include your reference code: <strong>{currentUser}</strong>
                    </div>
                  </div>
                )}
                {payMethod==="online" && (
                  <button className="btn btn-green" style={{width:"100%",marginTop:8}}
                    onClick={()=>{
                      if(region==="africa") handlePaystackPay(true);
                      else handleStripePay(true);
                    }}>
                    {region==="africa"
                      ? "Donate " + fmtNGN(APP_FEE_USD) + " via Paystack to Unlock your Outreach Link"
                      : "Donate " + (REGIONS[region]?.currency||"USD") + " " + fromUSD(APP_FEE_USD, REGIONS[region]?.currency||"USD").toFixed(2) + " via Stripe"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* NAV */}
      <nav className="nav">
        <div className="nav-logo" onClick={()=>setView("landing")}>
          <div className="nav-logo-mark">AOSF</div>
          <div>
            <div className="nav-brand">African Outreach Scholarship</div>
            <div className="nav-sub">Foundation</div>
          </div>
        </div>
        <div className="nav-links">
          <button className="nav-btn" onClick={()=>setView("landing")}>Home</button>
          {currentUser ? (
            <>
              <button className="nav-btn" onClick={()=>setView("portal")}>My Scholarship</button>
              <button className="nav-btn" onClick={logout}>Log Out</button>
            </>
          ) : (
            <>
              <button className="nav-btn" onClick={()=>setModal("login")}>Log In</button>
              <button className="nav-btn gold" onClick={()=>setView("apply")}>Apply Now</button>
            </>
          )}
          <button className="nav-btn" onClick={()=>setView("tc")}>T&amp;C</button>
          <button className="nav-btn" style={{opacity:0.15,fontSize:10,padding:"4px 8px"}}
            onClick={()=>setModal("admin_login")}>[ADM]</button>
        </div>
      </nav>

      {/* ── LANDING ─────────────────────────────────────────── */}
      {view==="landing" && (
        <div>
          <div className="hero">
            <div className="hero-eyebrow">African Outreach Scholarship Program</div>
            <h1 className="hero-title">
              Study Across Africa &amp; Abroad.<br/>
              <span>Fund Your Education Together.</span>
            </h1>
            <p className="hero-subtitle">
              A student-powered scholarship platform. Apply, share your outreach link, and USD 1.00 is credited to your account for every African student application received through your outreach link — direct and indirect.
            </p>
            <div className="hero-ctas">
              <button className="btn btn-gold" onClick={()=>setView("apply")}>Apply — Donate USD 5.00</button>
              <button className="btn btn-outline"
                onClick={()=>document.getElementById("how").scrollIntoView({behavior:"smooth"})}>
                How It Works
              </button>
            </div>
          </div>

          <div className="stats-bar">
            {[["USD 5.00","Scholarship Donation"],["USD 1.00","Per Direct Outreach"],
              ["USD 1.00","Per Indirect Outreach"],["USD 1.00","Per Extended Outreach"],
              ["USD 1,000","Per Link Cycle"],["Exponential","Outreach Circulation"]].map(([n,l])=>(
              <div className="stat" key={l}>
                <div className="stat-num">{n}</div>
                <div className="stat-label">{l}</div>
              </div>
            ))}
          </div>

          <div style={{background:WHITE,padding:"64px 0"}} id="how">
            <div className="section" style={{padding:"0 24px"}}>
              <div className="section-eyebrow">Simple Process</div>
              <div className="section-title">How AOSP Works</div>
              <div className="steps">
                {[
                     ["1","Apply & Donate USD 5.00","Submit your application and make a donation of USD 5.00 to unlock and activate your unique outreach link."],
                  ["2","Share Your Outreach Link","Send your outreach link to as many tertiary institution students you know in your country, in other African countries, in Canada, USA and the UK."],
                  ["3","Receive USD 1.00 per Application from your Direct Outreach","USD 1.00 is credited into your scholarship account for every student application received through your outreach link."],
                  ["4","Receive USD 1.00 per Application from your Indirect Outreach","When students from your direct outreach link share their own links and others apply, your scholarship account is further credited with USD 1.00 per application."],
                  ["5","Receive More Funding from Extended Applications","Applications from the outreach links of applicants from your indirect outreach result in yet another USD 1.00 credited to your scholarship account per application — students you have never met funding your education."],
                  ["6","Cash Out Your Scholarship Funds Anytime","Withdraw your scholarship funds to your local bank account with a single button press. Processed within 24 hours."],
                ].map(([n,t,b])=>(
                  <div className="step" key={n}>
                    <div className="step-num">{n}</div>
                    <div className="step-title">{t}</div>
                    <div className="step-body">{b}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="section">
            <div className="section-eyebrow">Real Illustration</div>
            <div className="section-title">See How Your Scholarship Funds Add Up</div>
            <div className="illus-box">
              {[
                {badge:"S1",text:"You apply and make a donation of USD 5.00 to unlock and activate your unique outreach link. Share with other students you know.",highlight:null},
                {badge:"10",text:"Assuming 10 students applied through your outreach link. And each unlocks and activates their own links.",highlight:"Your scholarship account is credited with 10 × USD 1.00 = USD 10.00 (Direct Outreach)"},
                {badge:"100",text:"Each of the 10 students share their own link and let's assume 10 more students apply through each of them — 100 new applications in total.",highlight:"Your scholarship account is credited with 100 × USD 1.00 = USD 100.00 (Indirect Outreach)"},
                {badge:"1K",text:"Again, let's imagine that each of these 100 applicants share their links and 10 more from each apply — 1,000 new applications are received from students you know absolutely nothing about.",highlight:"Your scholarship account is credited with 1,000 × USD 1.00 = USD 1,000.00 (Extended Outreach)"},
                {badge:"∑",text:"Your total scholarship funds from one outreach effort:",highlight:"USD 10 + USD 100 + USD 1,000 = USD 1,110.00 credited to your scholarship account. You will need to reactivate your outreach link with USD 5.00 donation for another cycle after receiving USD 1,000.00 from donated funds."},
              ].map((s,i)=>(
                <div className="illus-step" key={i}>
                  <div className="illus-badge">{s.badge}</div>
                  <div>
                    <div className="illus-text">{s.text}</div>
                    {s.highlight&&<div className="illus-highlight">✓ {s.highlight}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{background:GREEN_DARK,padding:"48px 24px",textAlign:"center"}}>
            <div style={{fontSize:28,fontWeight:900,color:WHITE,marginBottom:12}}>
              Ready to Fund Your Education?
            </div>
            <p style={{color:"rgba(255,255,255,0.8)",maxWidth:540,margin:"0 auto 24px",lineHeight:1.75}}>
              Join other African students across Africa and diaspora generating scholarship funds through the power of collective outreach. Apply today and donate just USD 5.00 to unlock your scholarship funding with this program.
            </p>
            <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
              <button className="btn btn-gold" onClick={()=>setView("apply")}>Apply Now — Donate USD 5.00</button>
              <button className="btn btn-outline" onClick={()=>setModal("login")}>Log In to My Portal</button>
            </div>
          </div>

          <div className="section" style={{textAlign:"center"}}>
            <div className="section-eyebrow">Eligibility</div>
            <div className="section-title">Who Can Apply</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",
              gap:20,marginTop:32}}>
              {[
                ["🎓","African Students in Africa","Any African student currently enrolled in any tertiary institution across all African countries."],
                ["🌍","International Students","African students studying in Canada, USA and the UK."],
                ["📱","18 Years & Above","Applicants must be 18 years or older and actively pursuing a tertiary education qualification."],
                ["🔗","Outreach Ready","You must be willing to share your unique outreach link with fellow students to achieve crowdfunding through their applications for your scholarship funding."],
                ["🌐","Post Graduate Students","African students on post graduate studies in Africa and diaspora."],
              ].map(([icon,title,body])=>(
                <div key={title} style={{background:WHITE,borderRadius:14,padding:24,
                  border:"1px solid #D4E8DC"}}>
                  <div style={{fontSize:36,marginBottom:12}}>{icon}</div>
                  <div style={{fontWeight:700,color:GREEN_DARK,fontSize:14,marginBottom:8}}>{title}</div>
                  <div style={{fontSize:13,color:MUTED,lineHeight:1.7}}>{body}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Legal Disclaimer Banner */}
          <div style={{background:"#1A1A2E",padding:"32px 24px",textAlign:"center"}}>
            <div style={{maxWidth:860,margin:"0 auto"}}>
              <div style={{fontSize:12,fontWeight:700,color:GOLD,letterSpacing:2,
                textTransform:"uppercase",marginBottom:12}}>Legal Disclaimer</div>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.55)",lineHeight:1.9}}>
                AOSP is a student-powered scholarship programme — not a financial investment scheme, pyramid scheme, or MLM.
                The USD 5.00 donation received is for a genuine scholarship account and outreach link.
                Credits are donated scholarship funds, not guaranteed income or investment returns.
                No financial return is promised. Participation is subject to the laws of your jurisdiction.
                Applicants in Canada, USA, and UK are advised to seek independent legal advice if in doubt.
                All disputes are governed by the laws of the Federal Republic of Nigeria.
              </div>
              <button style={{background:"none",border:"none",color:GOLD,fontSize:12,
                cursor:"pointer",marginTop:10,textDecoration:"underline"}}
                onClick={()=>setView("tc")}>
                Read Full Terms &amp; Conditions →
              </button>
            </div>
          </div>

          <div className="footer">
            <div className="footer-logo">African Outreach Scholarship Program</div>
            <div className="footer-sub">Powered by African Outreach Scholarship Foundation</div>
            <div style={{fontSize:13,color:GOLD,fontStyle:"italic",marginBottom:8,fontWeight:600}}>
              "Your Education Is Your Most Valuable Achievement"
            </div>
            <div className="footer-links">
              <button className="footer-link" onClick={()=>setView("apply")}>Apply</button>
              <button className="footer-link" onClick={()=>setModal("login")}>Log In</button>
              <button className="footer-link" onClick={()=>setView("tc")}>Terms &amp; Conditions</button>
            </div>
            <div className="footer-copy">
              ©2026 African Outreach Scholarship Program. All rights reserved.
            </div>
          </div>
        </div>
      )}

      {/* ── APPLICATION FORM ─────────────────────────────────── */}
      {view==="apply" && (
        <div style={{padding:"48px 24px",minHeight:"80vh"}}>
          <div className="form-wrap">
            <button onClick={()=>setView("landing")} style={{background:"none",border:"none",
              color:MUTED,cursor:"pointer",fontSize:13,marginBottom:16}}>← Back to Home</button>
            <div className="form-title">Apply for AOSP Scholarship</div>
            <div className="form-sub">
              Complete your application below. A USD 5.00 donation activates your scholarship account and outreach link. Your application details are saved immediately — donate to unlock your scholarship funding from your dashboard at any time.
            </div>

            {refUrl && (
              <div className="alert alert-gold">
                🔗 You have been granted application access through the outreach link of a fellow AOSP student. Apply now to secure your own outreach link and start receiving generated scholarship funds from the numerous applications across several higher learning institutions in 27 African countries.
              </div>
            )}

            <div className="section-divider">Personal Details</div>
            <div className="form-group">
              <label className="form-label">Full Name <span>*</span></label>
              <input className={"form-input"+(regErrors.fullName?" error":"")}
                placeholder="As on your student ID"
                value={regForm.fullName} onChange={e=>setRegForm(p=>({...p,fullName:e.target.value}))}/>
              {regErrors.fullName&&<div className="error-text">{regErrors.fullName}</div>}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Email Address <span>*</span></label>
                <input className={"form-input"+(regErrors.email?" error":"")}
                  type="email" placeholder="you@email.com"
                  value={regForm.email} onChange={e=>setRegForm(p=>({...p,email:e.target.value}))}/>
                {regErrors.email&&<div className="error-text">{regErrors.email}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Phone Number <span>*</span></label>
                <input className={"form-input"+(regErrors.phone?" error":"")}
                  placeholder="+234 800 000 0000"
                  value={regForm.phone} onChange={e=>setRegForm(p=>({...p,phone:e.target.value}))}/>
                {regErrors.phone&&<div className="error-text">{regErrors.phone}</div>}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Country <span>*</span></label>
              <select className="form-select" value={regForm.country}
                onChange={e=>setRegForm(p=>({...p,country:e.target.value}))}>
                {ELIGIBLE_COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="section-divider">Academic Details</div>
            <div className="form-group">
              <label className="form-label">Institution Name <span>*</span></label>
              <input className={"form-input"+(regErrors.institution?" error":"")}
                placeholder="e.g. University of Lagos, University of Ghana"
                value={regForm.institution} onChange={e=>setRegForm(p=>({...p,institution:e.target.value}))}/>
              {regErrors.institution&&<div className="error-text">{regErrors.institution}</div>}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Course of Study <span>*</span></label>
                <input className={"form-input"+(regErrors.course?" error":"")}
                  placeholder="e.g. Computer Science, Medicine, Law"
                  value={regForm.course} onChange={e=>setRegForm(p=>({...p,course:e.target.value}))}/>
                {regErrors.course&&<div className="error-text">{regErrors.course}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Level / Year <span>*</span></label>
                <select className="form-select" value={regForm.level}
                  onChange={e=>setRegForm(p=>({...p,level:e.target.value}))}>
                  {["100 Level","200 Level","300 Level","400 Level","500 Level",
                    "600 Level","Postgraduate","HND 1","HND 2","NCE 1","NCE 2","NCE 3"
                  ].map(l=><option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            </div>

            <div className="section-divider">Bank Account for Scholarship Cashout</div>
            <div className="alert alert-info" style={{fontSize:13}}>
              Your scholarship funds will be paid directly to this account when you request a cashout. Ensure the details are accurate.
            </div>
            <div className="form-group">
              <label className="form-label">Account Name <span>*</span></label>
              <input className={"form-input"+(regErrors.accountName?" error":"")}
                placeholder="Name on your bank account"
                value={regForm.accountName} onChange={e=>setRegForm(p=>({...p,accountName:e.target.value}))}/>
              {regErrors.accountName&&<div className="error-text">{regErrors.accountName}</div>}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Account Number <span>*</span></label>
                <input className={"form-input"+(regErrors.accountNumber?" error":"")}
                  placeholder="Your account number"
                  value={regForm.accountNumber} onChange={e=>setRegForm(p=>({...p,accountNumber:e.target.value}))}/>
                {regErrors.accountNumber&&<div className="error-text">{regErrors.accountNumber}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">Bank Name <span>*</span></label>
                <input className={"form-input"+(regErrors.accountBank?" error":"")}
                  placeholder="e.g. Zenith Bank, Equity Bank"
                  value={regForm.accountBank} onChange={e=>setRegForm(p=>({...p,accountBank:e.target.value}))}/>
                {regErrors.accountBank&&<div className="error-text">{regErrors.accountBank}</div>}
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Bank Country</label>
              <select className="form-select" value={regForm.accountCountry}
                onChange={e=>setRegForm(p=>({...p,accountCountry:e.target.value}))}>
                {ELIGIBLE_COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div className="section-divider">School ID Verification</div>
            <div className="form-group">
              <label className="form-label">Upload Valid School ID Card <span>*</span></label>
              <div style={{border:"2px dashed "+(regErrors.idFile?"#9F1239":"#D4E8DC"),
                borderRadius:10,padding:24,textAlign:"center",cursor:"pointer",
                background:idFile?"#F0FFF4":"#F8FBF9",transition:"all .2s"}}
                onClick={()=>document.getElementById("school-id-upload").click()}>
                {idFile ? (
                  <div>
                    <div style={{fontSize:28,marginBottom:8}}>✅</div>
                    <div style={{fontWeight:700,color:GREEN_DARK,fontSize:14}}>{idFile.name}</div>
                    <div style={{fontSize:12,color:MUTED,marginTop:4}}>
                      {(idFile.size/1024).toFixed(1)} KB — Click to change
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{fontSize:36,marginBottom:8}}>🪪</div>
                    <div style={{fontWeight:600,color:GREEN_DARK,fontSize:14,marginBottom:4}}>
                      Click to upload your School ID Card
                    </div>
                    <div style={{fontSize:12,color:MUTED}}>
                      Accepted formats: JPG, PNG, PDF — Max 5MB
                    </div>
                  </div>
                )}
              </div>
              <input id="school-id-upload" type="file"
                accept="image/jpeg,image/png,image/jpg,application/pdf"
                style={{display:"none"}}
                onChange={e=>{
                  const file = e.target.files[0];
                  if (file && file.size > 5*1024*1024) {
                    showAlert("File too large. Maximum size is 5MB.", "error");
                    return;
                  }
                  setIdFile(file||null);
                }}/>
              {regErrors.idFile && <div className="error-text">{regErrors.idFile}</div>}
              <div style={{fontSize:12,color:MUTED,marginTop:6,lineHeight:1.6}}>
                Upload a clear scan or photo of your current valid student ID card.
                This is required to verify your enrolment status at your institution.
              </div>
            </div>

            {regForm.referredBy && (
              <div className="form-group">
                <label className="form-label">Outreach Code (if applicable)</label>
                <input className="form-input" value={regForm.referredBy} readOnly
                  style={{background:"#F8FBF9",color:MUTED}}/>
              </div>
            )}

            <div style={{background:GOLD_BG,border:"1px solid "+(regErrors.tcAgreed?ERROR:GOLD),
              borderRadius:8,padding:16,marginBottom:20}}>
              <label style={{display:"flex",alignItems:"flex-start",gap:12,cursor:"pointer"}}>
                <input type="checkbox" checked={tcAgreed}
                  onChange={e=>setTcAgreed(e.target.checked)}
                  style={{width:18,height:18,marginTop:2,flexShrink:0,cursor:"pointer",accentColor:GREEN}}/>
                <span style={{fontSize:13,color:GREEN_DARK,lineHeight:1.75}}>
                  I confirm I am a student of a tertiary institution in an eligible country, aged 18 or above. I agree to the{" "}
                    <button style={{background:"none",border:"none",color:GREEN,cursor:"pointer",
                      fontWeight:700,padding:0,fontSize:13,textDecoration:"underline"}}
                      onClick={e=>{e.preventDefault();setView("tc");}}>
                      AOSP Terms &amp; Conditions
                    </button>
                    {" "}and understand the outreach link structure and USD 1,000 per cycle cap.
                </span>
              </label>
              {regErrors.tcAgreed&&<div style={{color:ERROR,fontSize:12,marginTop:8,marginLeft:30}}>{regErrors.tcAgreed}</div>}
            </div>

            <button className="btn btn-green" style={{width:"100%",fontSize:16,padding:15}}
              onClick={handleApply}>
              Submit Application
            </button>
            <div style={{textAlign:"center",marginTop:14,fontSize:13,color:MUTED}}>
              Already applied?{" "}
              <button style={{background:"none",border:"none",color:GREEN,cursor:"pointer",
                fontWeight:700,fontSize:13}} onClick={()=>setModal("login")}>Log in here</button>
            </div>
          </div>
        </div>
      )}

      {/* ── STUDENT PORTAL ───────────────────────────────────── */}
      {view==="portal" && applicant && (
        <div className="portal">
          <div className="portal-header">
            <div>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginBottom:4,
                letterSpacing:1,textTransform:"uppercase"}}>Welcome back</div>
              <div className="portal-name">{applicant.fullName}</div>
              <div className="portal-code">{applicant.refCode}</div>
              <div style={{fontSize:13,color:"rgba(255,255,255,0.75)",marginTop:6}}>
                {applicant.institution} — {applicant.course} ({applicant.level})
              </div>
              <div style={{fontSize:12,color:"rgba(255,255,255,0.6)",marginTop:2}}>
                {applicant.country}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"flex-end"}}>
              <div style={{
                background:applicant.status==="active"?"#DCFCE7":applicant.status==="pending"?"#FEF9C3":"#FEE2E2",
                color:applicant.status==="active"?"#166534":applicant.status==="pending"?"#854D0E":"#991B1B",
                padding:"4px 12px",borderRadius:20,fontSize:12,fontWeight:700}}>
                {applicant.status==="active"?"✓ Account Active":applicant.status==="pending"?"⏳ Donation Pending":"Inactive"}
              </div>
              {applicant.status==="active" && (
                <button className="btn btn-gold btn-sm" onClick={()=>setModal("withdraw")}>
                  💰 Cash Out
                </button>
              )}
            </div>
          </div>

          <div className="tabs">
            {[
              ["overview","Overview"],
              ...(!applicant.appFeePaid?[["payment","⚡ Donate & Activate"]]:[]),
              ["credits","My Credits"],
              ["cashouts","Cashouts"],
              ["outreach","Outreach Link"],
            ].map(([id,label])=>(
              <button key={id} className={"tab"+(portalTab===id?" active":"")}
                style={id==="payment"?{color:portalTab==="payment"?"#0F4526":GOLD,fontWeight:800}:{}}
                onClick={()=>setPortalTab(id)}>{label}</button>
            ))}
          </div>

          {/* OVERVIEW */}
          {portalTab==="overview" && (
            <>
              {!applicant.appFeePaid && (
                <div style={{background:"linear-gradient(135deg,"+GREEN_DARK+","+GREEN+")",
                  borderRadius:14,padding:28,marginBottom:24,border:"2px solid "+GOLD,textAlign:"center"}}>
                  <div style={{fontSize:13,color:"rgba(255,255,255,0.7)",marginBottom:6,
                    textTransform:"uppercase",letterSpacing:1,fontWeight:700}}>Action Required</div>
                  <div style={{fontSize:22,fontWeight:900,color:GOLD,marginBottom:10}}>
                    Activate Your Scholarship Account
                  </div>
                  <div style={{fontSize:14,color:"rgba(255,255,255,0.85)",maxWidth:480,
                    margin:"0 auto 20px",lineHeight:1.75}}>
                    Make a USD 5.00 scholarship donation to activate your outreach link and to allow scholarship funds to be credited into your new scholarship account.
                  </div>
                  <button className="btn btn-gold" onClick={()=>setPortalTab("payment")}>
                    Donate USD 5.00 — Activate Now
                  </button>
                </div>
              )}

              <div className="balance-card">
                <div className="balance-label">Scholarship Balance</div>
                <div className="balance-amount">{fmtUSD(applicant.balance)}</div>
                <div className="balance-ngn">≈ {fmtNGN(applicant.balance)}</div>
                {applicant.status==="active" && (
                  <button className="btn btn-gold btn-sm" style={{marginTop:16}}
                    onClick={()=>setModal("withdraw")}>
                    💰 Cash Out to My Bank Account
                  </button>
                )}
              </div>

              <div className="grid-4" style={{marginBottom:16}}>
                <div className="info-card">
                  <div className="info-card-label">Total Received</div>
                  <div className="info-card-value" style={{fontSize:18}}>{fmtUSD(applicant.totalEarned)}</div>
                  <div className="info-card-sub">All cycles combined</div>
                </div>
                <div className="info-card">
                  <div className="info-card-label">Total Withdrawn</div>
                  <div className="info-card-value" style={{fontSize:18}}>{fmtUSD(applicant.totalWithdrawn)}</div>
                  <div className="info-card-sub">Cashed out to bank</div>
                </div>
                <div className="info-card">
                  <div className="info-card-label">Cycle Fundings</div>
                  <div className="info-card-value" style={{fontSize:18}}>{fmtUSD(applicant.linkEarned)}</div>
                  <div className="info-card-sub">of USD {LINK_CAP} cap</div>
                </div>
                <div className="info-card">
                  <div className="info-card-label">Link Status</div>
                  <div className="info-card-value" style={{fontSize:18,color:applicant.linkActive?SUCCESS:ERROR}}>
                    {applicant.linkActive?"Active":"Inactive"}
                  </div>
                  <div className="info-card-sub">Cycle {applicant.linkCycle}</div>
                </div>
              </div>

              {applicant.appFeePaid && (
                <div style={{background:WHITE,borderRadius:12,padding:20,
                  border:"1px solid #D4E8DC",marginBottom:20}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,
                    fontWeight:600,color:GREEN_DARK,marginBottom:6}}>
                    <span>Your Outreach Link / Scholarship Funding Progress — Cycle {applicant.linkCycle}</span>
                    <span>{fmtUSD(applicant.linkEarned)} / USD {LINK_CAP}</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-fill" style={{width:linkPct+"%"}}/>
                  </div>
                  <div style={{fontSize:12,color:MUTED,marginTop:4}}>
                    {applicant.linkActive
                      ? fmtUSD(LINK_CAP - applicant.linkEarned) + " remaining before link requires reactivation"
                      : "Link cap reached — reactivate with USD 5 to start a new cycle"}
                  </div>
                  {!applicant.linkActive && (
                    <button className="btn btn-gold btn-sm" style={{marginTop:12}}
                      onClick={()=>setModal("reactivate")}>
                      Reactivate Outreach Link — USD 5.00
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {/* PAY FEE TAB */}
          {portalTab==="payment" && !applicant.appFeePaid && (
            <>
              <div style={{fontWeight:900,fontSize:20,color:GREEN_DARK,marginBottom:6}}>
                Make Your Scholarship Donation — USD {APP_FEE_USD}.00
              </div>
              <div style={{fontSize:14,color:MUTED,marginBottom:20,lineHeight:1.6}}>
                Make your USD 5.00 scholarship donation to activate your scholarship account and outreach link.
              </div>
              <div style={{background:GOLD_BG,border:"1px solid "+GOLD,borderRadius:10,padding:16,marginBottom:20}}>
                {[["Reference Code",applicant.refCode],["Applicant",applicant.fullName],
                  ["Institution",applicant.institution],
                  ["Scholarship Donation","USD "+APP_FEE_USD+".00 (≈ "+fmtNGN(APP_FEE_USD)+")"],
                ].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",
                    padding:"6px 0",borderBottom:"1px solid rgba(201,168,76,0.3)",fontSize:13}}>
                    <span style={{color:MUTED}}>{k}</span>
                    <span style={{fontWeight:700,color:GREEN_DARK}}>{v}</span>
                  </div>
                ))}
              </div>
              {/* Region Selector */}
              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:600,color:GREEN_DARK,marginBottom:10}}>
                  Select Your Payment Region
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}>
                  {Object.entries(REGIONS).map(([key,r])=>(
                    <div key={key}
                      className={"pay-option"+(region===key?" active":"")}
                      onClick={()=>setRegion(key)}
                      style={{padding:"12px 10px"}}>
                      <div style={{fontSize:24,marginBottom:4}}>{r.flag}</div>
                      <div style={{fontSize:12,fontWeight:700,color:GREEN_DARK}}>{r.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="payment-options" style={{gridTemplateColumns:region==="canada"?"1fr 1fr 1fr":"1fr 1fr"}}>
                <div className={"pay-option"+(payMethod==="online"?" active":"")} onClick={()=>setPayMethod("online")}>
                  <div style={{fontSize:28,marginBottom:8}}>💳</div>
                  <div className="pay-option-title">Pay Online</div>
                  <div className="pay-option-sub">
                    {region==="africa"?"Card via Paystack":"Card via Stripe"}
                  </div>
                </div>
                {region==="canada" && (
                  <div className={"pay-option"+(payMethod==="interac"?" active":"")} onClick={()=>setPayMethod("interac")}>
                    <div style={{fontSize:28,marginBottom:8}}>🍁</div>
                    <div className="pay-option-title">Interac e-Transfer</div>
                    <div className="pay-option-sub">Canadian bank transfer</div>
                  </div>
                )}
                <div className={"pay-option"+(payMethod==="bank"?" active":"")} onClick={()=>setPayMethod("bank")}>
                  <div style={{fontSize:28,marginBottom:8}}>🏦</div>
                  <div className="pay-option-title">Bank Transfer</div>
                  <div className="pay-option-sub">Then notify via WhatsApp</div>
                </div>
              </div>

              {payMethod==="interac" ? (
                <div style={{background:"#F0FFF4",border:"2px solid #86EFAC",borderRadius:12,padding:24}}>
                  <div style={{fontWeight:800,fontSize:15,color:GREEN_DARK,marginBottom:12}}>
                    🍁 Interac e-Transfer Instructions
                  </div>
                  <div className="bank-details">
                    {[
                      ["Send To (Email)","aosf2026@gmail.com"],
                      ["Donation Amount","CAD " + fromUSD(APP_FEE_USD,"CAD").toFixed(2) + " (≈ USD " + APP_FEE_USD + ")"],
                      ["Message / Note",applicant.refCode + " — AOSP Scholarship Donation"],
                      ["Autodeposit","Enabled — no security question needed"],
                    ].map(([k,v])=>(
                      <div className="bank-row" key={k}>
                        <span style={{color:MUTED}}>{k}</span>
                        <span style={{fontWeight:700,color:GREEN_DARK,wordBreak:"break-all"}}>{v}
                          {k==="Send To (Email)"&&(
                            <button className="copy-btn"
                              onClick={()=>{navigator.clipboard?.writeText("aosf2026@gmail.com");showAlert("Email copied!");}}>Copy</button>
                          )}
                          {k==="Message / Note"&&(
                            <button className="copy-btn"
                              onClick={()=>{navigator.clipboard?.writeText(applicant.refCode+" — AOSP Scholarship Donation");showAlert("Copied!");}}>Copy</button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:13,color:"#92400E",marginTop:12,lineHeight:1.8,
                    background:"#FFFBEB",border:"1px solid #FCD34D",borderRadius:8,padding:"10px 14px"}}>
                    ⚠️ Include your reference code <strong>{applicant.refCode}</strong> in the message field so we can identify your payment.<br/>
                    After sending, notify us via WhatsApp: <strong>+234 909 999 4816</strong><br/>
                    Your account will be activated within 24 hours of confirmation.
                  </div>
                </div>
              ) : payMethod==="online" ? (
                <>
                  <div className="alert alert-info" style={{fontSize:13}}>
                    {region==="africa"
                      ? "Your outreach link activates immediately after Paystack confirms your payment."
                      : "Make your donation securely via Stripe. Your outreach link activates after donation confirmation. Amount: " + REGIONS[region]?.currency + " " + fromUSD(APP_FEE_USD, REGIONS[region]?.currency || "USD").toFixed(2) + " (≈ USD " + APP_FEE_USD + ")"}
                  </div>
                  {region === "africa" ? (
                    <button className="btn btn-green" style={{width:"100%",fontSize:16,padding:15}}
                      onClick={()=>{setPendingCode(applicant.refCode);handlePaystackPay(false);}}>
                      Donate {fmtNGN(APP_FEE_USD)} via Paystack to Unlock your Outreach Link
                    </button>
                  ) : (
                    <div style={{background:"#F0FFF4",border:"2px solid #86EFAC",
                      borderRadius:12,padding:20}}>
                      <div style={{fontWeight:700,color:GREEN_DARK,marginBottom:8,fontSize:14}}>
                        💳 Secure Card Payment via Stripe
                      </div>
                      <div style={{fontSize:13,color:MUTED,marginBottom:16,lineHeight:1.7}}>
                        You will be taken to Stripe's secure hosted payment page.
                        Amount: <strong>{REGIONS[region]?.currency} {fromUSD(APP_FEE_USD,REGIONS[region]?.currency||"USD").toFixed(2)}</strong> (≈ USD {APP_FEE_USD}).
                        After payment you return to your portal automatically.
                      </div>
                      <button style={{display:"block",width:"100%",
                        background:GREEN_DARK,color:WHITE,padding:"14px 20px",
                        borderRadius:8,textAlign:"center",fontWeight:700,fontSize:15,
                        border:"none",cursor:"pointer"}}
                        onClick={()=>handleStripePay(false)}>
                        Proceed to Stripe Payment →
                      </button>
                      {stripeError&&<div className="error-text" style={{marginTop:8}}>{stripeError}</div>}
                    </div>
                  )}
                </>
              ) : (
                <div style={{background:"#F0FFF4",border:"2px solid #86EFAC",borderRadius:12,padding:24}}>
                  <div style={{fontWeight:800,fontSize:15,color:GREEN_DARK,marginBottom:12}}>
                    Bank Transfer Instructions
                  </div>
                  <div className="bank-details">
                    {[["Account Name","RoyalTech Partnership & Investment Limited"],
                      ["Account Number","1016621205"],["Bank","Zenith Bank"],
                      ["Amount",fmtNGN(APP_FEE_USD)+" (≈ USD "+APP_FEE_USD+")"],
                      ["Reference",applicant.refCode],
                    ].map(([k,v])=>(
                      <div className="bank-row" key={k}>
                        <span style={{color:MUTED}}>{k}</span>
                        <span style={{fontWeight:700,color:GREEN_DARK}}>{v}
                          {k==="Account Number"&&<button className="copy-btn"
                            onClick={()=>{navigator.clipboard?.writeText("1016621205");showAlert("Copied!");}}>Copy</button>}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:14,color:GREEN_DARK,marginTop:12,lineHeight:1.8}}>
                    {region==="africa" ? (
                      <span>After transferring, send your proof of payment via WhatsApp to:<br/>
                        <strong style={{fontSize:16}}>📱 09099994816</strong><br/>
                        Include your reference code: <strong>{applicant.refCode}</strong><br/>
                        Your account will be activated within 24 hours.
                      </span>
                    ) : (
                      <span>
                        <strong>For Canada:</strong> Send Interac e-Transfer to: <strong>aosf2026@gmail.com</strong><br/>
                        <strong>For USA/UK:</strong> Use Wise or international wire to your nearest RoyalTech correspondent.<br/>
                        Amount: <strong>{REGIONS[region]?.currency} {fromUSD(APP_FEE_USD, REGIONS[region]?.currency||"USD").toFixed(2)}</strong> (≈ USD {APP_FEE_USD})<br/>
                        Reference: <strong>{applicant.refCode}</strong><br/>
                        After payment, send proof via WhatsApp: <strong>📱 +234 909 999 4816</strong><br/>
                        Your account will be activated within 24 hours.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* CREDITS TAB */}
          {portalTab==="credits" && (
            <>
              <div style={{fontWeight:900,fontSize:20,color:GREEN_DARK,marginBottom:16}}>
                Scholarship Credits ({myCredits.length})
              </div>
              {myCredits.length===0 ? (
                <div style={{textAlign:"center",padding:"48px 20px",color:MUTED}}>
                  <div style={{fontSize:48,marginBottom:12}}>📚</div>
                  <div style={{fontWeight:700,marginBottom:8}}>No credits yet</div>
                  <div style={{fontSize:14}}>Share your outreach link to start earning scholarship funds.</div>
                </div>
              ) : (
                <>
                  <div style={{display:"flex",gap:16,flexWrap:"wrap",marginBottom:20}}>
                    {[["Direct","direct","badge-direct"],["1st Extension","indirect_1","badge-indirect1"],
                      ["2nd Extension","indirect_2","badge-indirect2"]].map(([label,type,cls])=>{
                      const total = myCredits.filter(c=>c.type===type).reduce((s,c)=>s+c.amount,0);
                      const count = myCredits.filter(c=>c.type===type).length;
                      return (
                        <div key={type} className="info-card" style={{flex:1,minWidth:140}}>
                          <span className={"credit-type-badge "+cls} style={{marginBottom:8,display:"inline-block"}}>{label}</span>
                          <div className="info-card-value" style={{fontSize:18}}>{fmtUSD(total)}</div>
                          <div className="info-card-sub">{count} credit(s)</div>
                        </div>
                      );
                    })}
                  </div>
                  {myCredits.map(c=>(
                    <div key={c.id} style={{background:WHITE,borderRadius:10,padding:16,
                      marginBottom:10,border:"1px solid #D4E8DC",
                      display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <span className={"credit-type-badge "+(c.type==="direct"?"badge-direct":c.type==="indirect_1"?"badge-indirect1":c.type==="indirect_2"?"badge-indirect2":"badge-reactivation")}>
                          {c.type==="direct"?"Direct":c.type==="indirect_1"?"1st Extension":c.type==="indirect_2"?"2nd Extension":"Reactivation"}
                        </span>
                        <div style={{fontSize:12,color:MUTED,marginTop:6}}>
                          {new Date(c.createdAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}
                        </div>
                      </div>
                      <div style={{fontWeight:900,fontSize:18,color:SUCCESS}}>+{fmtUSD(c.amount)}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {/* CASHOUTS TAB */}
          {portalTab==="cashouts" && (
            <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div style={{fontWeight:900,fontSize:20,color:GREEN_DARK}}>Cashout History</div>
                {applicant.status==="active" && applicant.balance > 0 && (
                  <button className="btn btn-gold btn-sm" onClick={()=>setModal("withdraw")}>
                    💰 Cash Out Now
                  </button>
                )}
              </div>
              {myWithdrawals.length===0 ? (
                <div style={{textAlign:"center",padding:"48px 20px",color:MUTED}}>
                  <div style={{fontSize:48,marginBottom:12}}>💸</div>
                  <div style={{fontWeight:700,marginBottom:8}}>No cashouts yet</div>
                  <div style={{fontSize:14}}>Build your scholarship balance and cash out anytime.</div>
                </div>
              ) : myWithdrawals.map(w=>(
                <div key={w.id} style={{background:WHITE,borderRadius:10,padding:16,
                  marginBottom:10,border:"1px solid #D4E8DC",
                  display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:14,color:GREEN_DARK}}>{fmtUSD(w.amount)}</div>
                    <div style={{fontSize:12,color:MUTED,marginTop:4}}>
                      {new Date(w.createdAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})}
                    </div>
                    {w.processedAt && (
                      <div style={{fontSize:12,color:SUCCESS,marginTop:2}}>
                        Processed: {new Date(w.processedAt).toLocaleDateString("en-GB")}
                      </div>
                    )}
                  </div>
                  <span className={"status-pill "+(w.status==="processed"?"pill-processed":"pill-pending")}>
                    {w.status==="processed"?"✓ Processed":"⏳ Processing"}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* OUTREACH LINK TAB */}
          {portalTab==="outreach" && (
            <>
              {!applicant.appFeePaid ? (
                <div style={{textAlign:"center",padding:"48px 20px"}}>
                  <div style={{fontSize:48,marginBottom:16}}>🔒</div>
                  <div style={{fontWeight:900,fontSize:20,color:GREEN_DARK,marginBottom:8}}>
                    Outreach Link Locked
                  </div>
                  <div style={{fontSize:14,color:MUTED,marginBottom:24,lineHeight:1.7}}>
                    Make your USD 5.00 scholarship donation to unlock your outreach link.
                  </div>
                  <button className="btn btn-green" onClick={()=>setPortalTab("payment")}>
                    Donate USD 5 to Unlock
                  </button>
                </div>
              ) : (
                <>
                  <div className="outreach-card">
                    <div style={{fontSize:12,letterSpacing:2,textTransform:"uppercase",
                      color:GOLD,fontWeight:700,marginBottom:6}}>Your Outreach Link</div>
                    <div style={{fontSize:13,color:"rgba(255,255,255,0.75)",lineHeight:1.75,marginBottom:4}}>
                      Share this link with students across Africa. Every application earns you USD 1.00.
                    </div>
                    <div style={{display:"inline-flex",alignItems:"center",gap:8,
                      background:applicant.linkActive?"rgba(255,255,255,0.1)":"rgba(255,0,0,0.2)",
                      padding:"4px 12px",borderRadius:20,marginBottom:12}}>
                      <div style={{width:8,height:8,borderRadius:"50%",
                        background:applicant.linkActive?"#4ADE80":"#F87171"}}/>
                      <span style={{fontSize:12,color:"rgba(255,255,255,0.9)"}}>
                        {applicant.linkActive
                          ? "Active — Cycle "+applicant.linkCycle+" | "+fmtUSD(LINK_CAP-applicant.linkEarned)+" remaining"
                          : "Inactive — Make a new USD 5.00 donation to start a new cycle"}
                      </span>
                    </div>
                    <div className="outreach-link-box">
                      <span style={{fontSize:13,color:"rgba(255,255,255,0.9)",flex:1}}>{outreachLink}</span>
                      <button className="btn btn-gold btn-sm"
                        onClick={()=>{navigator.clipboard?.writeText(outreachLink);showAlert("Link copied!");}}>
                        Copy
                      </button>
                    </div>
                    {!applicant.linkActive && (
                      <button className="btn btn-gold" style={{marginTop:16,width:"100%"}}
                        onClick={()=>setModal("reactivate")}>
                        Reactivate for USD 5 — Start New Cycle
                      </button>
                    )}
                  </div>

                  <div style={{background:WHITE,borderRadius:12,padding:24,
                    border:"1px solid #D4E8DC",marginBottom:20}}>
                    <div style={{fontWeight:700,color:GREEN_DARK,marginBottom:16,fontSize:15}}>
                      Your Scholarship Funding Structure
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
                      {[["Direct Outreach","USD 1.00 each","Applications from students who apply through your link directly"],
                        ["Indirect Outreach","USD 1.00 each","Applications from links of applicants from your direct outreach"],
                        ["Extended Outreach","USD 1.00 each","Applications from links of applicants from your indirect outreach"],
                        ["Link Cap","USD 1,000 / cycle","Reactivate for USD 5 after each USD 1,000 scholarship funds received"],
                      ].map(([title,amount,desc])=>(
                        <div key={title} style={{background:"#F0F6F2",borderRadius:10,padding:16,textAlign:"center"}}>
                          <div style={{fontSize:11,color:MUTED,fontWeight:700,
                            textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>{title}</div>
                          <div style={{fontSize:18,fontWeight:900,color:GREEN_DARK}}>{amount}</div>
                          <div style={{fontSize:11,color:MUTED,marginTop:6,lineHeight:1.5}}>{desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="alert alert-gold">
                    <strong>Sharing tip:</strong> Share your link in student WhatsApp groups,
                    university notice boards, student union channels, and across social media.
                    Target students in multiple institutions and countries for maximum reach.
                  </div>

                  {/* Outreach Ad Templates */}
                  <div style={{marginTop:24}}>
                    <div style={{fontWeight:800,fontSize:16,color:GREEN_DARK,marginBottom:6}}>
                      📢 Ready-to-Share Outreach Templates
                    </div>
                    <div style={{fontSize:13,color:MUTED,marginBottom:16,lineHeight:1.7}}>
                      Copy any version below, replace the sample link with your unique outreach link above, and share directly on WhatsApp, Facebook, or email.
                    </div>
                    {[
                      {
                        region:"🌍 Africa (General)",
                        amount:"NGN 8,000 (≈ USD 5.00)",
                        payment:"Paystack or Direct Transfer",
                        institutions:"1,331+ institutions across 54 African countries",
                        color:"#F0F6F2",
                        border:"#2D9B5A",
                      },
                      {
                        region:"🇨🇦 Canada",
                        amount:"CAD 6.25 (≈ USD 5.00)",
                        payment:"Stripe card or Interac e-Transfer",
                        institutions:"301+ institutions in Canada",
                        color:"#FFF5F5",
                        border:"#EF4444",
                      },
                      {
                        region:"🇺🇸 United States",
                        amount:"USD 5.00",
                        payment:"Stripe card",
                        institutions:"3,896 degree-granting colleges & universities in the US",
                        color:"#EFF6FF",
                        border:"#3B82F6",
                      },
                      {
                        region:"🇬🇧 United Kingdom",
                        amount:"GBP 3.95 (≈ USD 5.00)",
                        payment:"Stripe card",
                        institutions:"169 higher education providers in the UK",
                        color:"#F5F3FF",
                        border:"#8B5CF6",
                      },
                    ].map((t,i)=>{
                      const template = "🎓 \"Your Education Is Your Most Valuable Achievement.\"\n\nA student has shared this opportunity with you — and it could change your academic journey.\n\nThe African Outreach Scholarship Program (AOSP) is a student-powered scholarship programme open to African students. Your outreach generates real donated scholarship funds credited directly into your scholarship account.\n\nHow it works:\n📌 Start things off by making a donation of " + t.amount + " to unlock your unique outreach link and scholarship account for funding\n📌 Every student who applies through your link = USD 1.00 credited to your scholarship account\n📌 Here is where the Magic happens — You get USD 1.00 credited into your account again and again every time applicants from your link generate more applications from their own outreach links\n📌 To get started, donate via " + t.payment + " — no hassle\n📌 Cash out your scholarship funds to your local bank account anytime\n\nYour link reaches over 5,700 institutions across Africa, USA, UK & Canada — including " + t.institutions + ".\n\nThis opportunity was shared with you. If you are not a student, please pass it on. If you are an African student, don\'t just pass it on — ensure you apply, unlock your own unique outreach link, and start a trend that makes you a direct beneficiary.\n\n🔗 Apply here:\n" + outreachLink;
                      return (
                        <div key={i} style={{background:t.color,border:"2px solid "+t.border,
                          borderRadius:12,padding:20,marginBottom:16}}>
                          <div style={{display:"flex",justifyContent:"space-between",
                            alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
                            <div style={{fontWeight:800,fontSize:14,color:GREEN_DARK}}>{t.region}</div>
                            <button className="btn btn-sm"
                              style={{background:t.border,color:WHITE,fontSize:12}}
                              onClick={()=>{
                                navigator.clipboard?.writeText(template);
                                showAlert(t.region + " template copied! Replace the link if needed before sharing.");
                              }}>
                              Copy Template
                            </button>
                          </div>
                          <pre style={{fontSize:12,color:GREEN_DARK,whiteSpace:"pre-wrap",
                            lineHeight:1.7,fontFamily:"inherit",margin:0}}>
                            {template}
                          </pre>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── TERMS & CONDITIONS ──────────────────────────────── */}
      {view==="tc" && (
        <div style={{padding:"48px 24px",minHeight:"80vh"}}>
          <div style={{background:WHITE,borderRadius:16,padding:40,maxWidth:840,
            margin:"0 auto",boxShadow:"0 2px 12px rgba(15,69,38,0.08)"}}>
            <button onClick={()=>setView("landing")} style={{background:"none",border:"none",
              color:MUTED,cursor:"pointer",fontSize:13,marginBottom:20}}>
              ← Back to Home
            </button>
            <div style={{textAlign:"center",marginBottom:36}}>
              <div style={{fontSize:28,fontWeight:900,color:GREEN_DARK,marginBottom:6}}>
                Terms &amp; Conditions
              </div>
              <div style={{fontSize:13,color:MUTED}}>
                African Outreach Scholarship Program (AOSP)
              </div>
              <div style={{fontSize:12,color:MUTED,marginTop:4}}>
                Powered by African Outreach Scholarship Foundation | Effective: 2026
              </div>
            </div>

            {[
              {
                title:"1. About AOSP",
                body:"The African Outreach Scholarship Program (AOSP) is a student-powered scholarship programme operated by African Outreach Scholarship Foundation, 2B, Olawale Cole, Onitiri Avenue, Lekki Phase 1, Lekki - Lagos, Nigeria. The programme enables students of tertiary institutions across Africa and in the UK, US and Canada to generate scholarship funds by sharing their unique outreach links with fellow students.",
              },
              {
                title:"2. Eligibility",
                items:[
                  "AOSP is open to students aged 18 years and above who are currently enrolled in a university, polytechnic, or college of education in any of the following eligible countries: Ghana, Kenya, Nigeria, Rwanda, South Africa, Tanzania, Uganda, Zambia, and Zimbabwe; and to African students currently enrolled in tertiary institutions in Canada, the United States of America, and the United Kingdom.",
                  "Applicants must provide accurate and verifiable personal, academic, and bank account details at the point of application.",
                  "AOSP reserves the right to verify the academic enrolment status of any applicant at any time and to suspend or terminate accounts found to have provided false information.",
                  "Each applicant may hold only one active AOSP account. Multiple accounts using the same email address, phone number, or bank account details are not permitted.",
                ],
              },
              {
                title:"3. Scholarship Donation",
                items:[
                  "A non-refundable scholarship donation of USD 5.00 (or its equivalent in local currency at the prevailing exchange rate) is required to activate a scholarship account and outreach link.",
                  "The USD 5.00 scholarship donation is strictly non-refundable under all circumstances, including but not limited to: change of mind, inability to share the outreach link, failure to receive applications through the link, or withdrawal from the programme.",
                  "The same USD 5.00 reactivation donation applies each time an outreach link is reactivated after reaching the USD 1,000.00 per received donation cycle cap.",
                  "An applicant's outreach link and scholarship account are activated only upon confirmation of the donation by AOSP. Until confirmation, the account remains in pending status.",
                ],
              },
              {
                title:"4. Outreach Link and Scholarship Credit Structure",
                items:[
                  "Upon activation, each applicant receives a unique outreach link tied to their scholarship account.",
                  "DIRECT OUTREACH CREDIT: When a student applies to AOSP through your outreach link and unlocks their own outreach link, you receive a credit of USD 1.00 to your scholarship account.",
                  "INDIRECT OUTREACH CREDIT: When an applicant from your direct outreach shares their own outreach link and other students apply through it and likewise unlock their own outreach link, you receive a further credit of USD 1.00 to your scholarship account.",
                  "EXTENDED OUTREACH CREDIT: When an applicant from your indirect outreach shares their own outreach link and other students apply through it and likewise unlock their own outreach link, you again receive a further credit of USD 1.00 to your scholarship account.",
                  "The credit chain extends to three levels of outreach only — Direct, Indirect, and Extended. No further credits are generated beyond this 3rd level.",
                  "Credits are generated only when the referred applicant's USD 5.00 donation is confirmed. Pending donations do not generate credits.",
                  "AOSP reserves the right to withhold or reverse credits found to have been generated through fraudulent, manipulated, or artificial applications.",
                ],
              },
              {
                title:"5. Outreach Link Cap and Reactivation",
                items:[
                  "Each outreach link has a scholarship funding cap of USD 1,000.00 per cycle, counting all direct, indirect, and extended outreach credits combined.",
                  "Once an outreach link achieves the USD 1,000.00 cap, it becomes inactive and no further credits are generated through that link until it is reactivated.",
                  "Reactivation requires a non-refundable donation of USD 5.00. Upon confirmation, a new USD 1,000.00 scholarship funding cycle begins.",
                  "An applicant's scholarship balance and total credit history are preserved across all reactivation cycles.",
                  "AOSP is not responsible for any credits not received during the period when a link is inactive pending reactivation.",
                ],
              },
              {
                title:"6. Scholarship Fund Cashout",
                items:[
                  "Applicants may request a cashout of their available scholarship balance at any time from their portal.",
                  "The minimum cashout amount is USD 50.00. Requests below this threshold will not be processed.",
                  "All cashout requests are subject to review and approval by AOSP before processing. Approval is not automatic.",
                  "Approved cashouts are processed to the applicant's registered local bank account within 24 hours of approval.",
                  "Cashouts are made in local currency at the prevailing exchange rate on the date of processing. AOSP is not liable for exchange rate fluctuations between the date of request and the date of processing.",
                  "It is the applicant's responsibility to provide accurate bank account details. AOSP shall not be liable for funds sent to incorrect account details provided by the applicant.",
                  "AOSP reserves the right to place a temporary hold on cashout requests pending verification of the applicant's account or credit history.",
                ],
              },
              {
                title:"7. Prohibited Conduct",
                items:[
                  "Applicants must not create or operate multiple accounts for the purpose of generating artificial credits.",
                  "Applicants must not use automated tools, bots, or scripts to generate applications through their outreach link.",
                  "Applicants must not misrepresent the AOSP programme in their outreach communications.",
                  "Any attempt to manipulate the credit structure, defraud the programme, or circumvent the outreach link cap will result in immediate account suspension and forfeiture of all accumulated credits.",
                ],
              },
              {
                title:"8. Platform Changes",
                items:[
                  "AOSP reserves the right to modify the donation amount, credit amounts, outreach link cap, or any other programme terms at any time prior to an applicant making a financial commitment.",
                  "Once an applicant's scholarship donation has been confirmed, the terms applicable to that applicant's current active cycle shall remain binding for the duration of that cycle.",
                  "AOSP reserves the right to suspend or terminate the programme with reasonable notice to active participants.",
                ],
              },
              {
                title:"9. Limitation of Liability",
                items:[
                  "AOSP credits are not a guaranteed income and depend entirely on the volume of applications generated through an applicant's outreach link and its extensions.",
                  "AOSP makes no guarantee as to the number of applications any outreach link will generate.",
                  "AOSP's total liability to any applicant shall not exceed the confirmed credit balance in that applicant's scholarship account at the time of any dispute.",
                ],
              },
              {
                title:"10. Dispute Resolution",
                items:[
                  "Any dispute arising from the AOSP programme shall first be referred to the African Outreach Scholarship Foundation for resolution through direct negotiation.",
                  "If not resolved within 14 working days, the dispute shall be referred to mediation under mutually agreed terms.",
                  "If mediation fails, the dispute shall be resolved by arbitration under the jurisdiction of the Federal Republic of Nigeria, seated in Lagos State.",
                  "These Terms and Conditions are governed by the laws of the Federal Republic of Nigeria.",
                ],
              },
              {
                title:"11. Contact",
                body:"For all enquiries, support, or complaints contact African Outreach Scholarship Foundation: Phone: +234 806 163 1222 | WhatsApp: +234 909 999 4816 | Email: aosf2026@gmail.com | Address: SiteTech Office, Alinas Mall, Opposite Crown Estate, Lekki-Epe Express Road, Lagos, Nigeria.",
              },
              {
                title:"12. Legal Disclaimer",
                items:[
                  "The African Outreach Scholarship Program (AOSP) is a scholarship programme and not a financial investment scheme, a pyramid scheme, a Ponzi scheme, or a multi-level marketing (MLM) programme. The USD 5.00 scholarship donation is made in exchange for a genuine scholarship account and a unique outreach link — both of which are real and functional deliverables provided to every applicant upon payment confirmation.",
                  "Credits generated through the AOSP outreach link structure are donated scholarship funds, not investment returns, commissions, or guaranteed income. No financial return is promised or guaranteed to any applicant. The amount credited to any scholarship account depends entirely on the volume of applications received through that applicant's outreach link and its extensions, and is in no way guaranteed by AOSP or African Outreach Scholarship Foundation.",
                  "AOSP does not operate as a bank, financial institution, money services business, or regulated financial product in any jurisdiction. Cashout payments are processed as scholarship disbursements and are subject to administrative review and approval by AOSF before processing.",
                  "Applicants are responsible for understanding and complying with the laws and regulations applicable to their participation in AOSP in their respective countries of residence or study. AOSP makes no representation that participation in the programme is legally permissible in all jurisdictions. Applicants in Canada, the United States, the United Kingdom, and other regulated jurisdictions are advised to seek independent legal advice before participating if they have any concerns about the legality of the programme in their jurisdiction.",
                  "AOSP does not guarantee, represent, or warrant that the programme will operate indefinitely. African Outreach Scholarship Foundation (AOSF) reserves the right to modify, suspend, or terminate the programme at any time, subject to the obligations already incurred to active participants as outlined in these Terms and Conditions.",
                  "Nothing in these Terms and Conditions constitutes financial, legal, or investment advice. Applicants are encouraged to seek independent professional advice before making any financial decisions in connection with their participation in AOSP.",
                  "These Terms and Conditions, and all disputes arising from or in connection with the AOSP programme (AOSF), are governed by the laws of the Federal Republic of Nigeria. By applying, participants from all jurisdictions consent to this governing law.",
                ],
              },
            ].map((section, i) => (
              <div key={i} style={{marginBottom:28}}>
                <div style={{fontWeight:800,fontSize:15,color:GREEN_DARK,
                  borderLeft:"4px solid "+GREEN,paddingLeft:12,marginBottom:12}}>
                  {section.title}
                </div>
                {section.body && (
                  <div style={{fontSize:14,color:MUTED,lineHeight:1.85,paddingLeft:16}}>
                    {section.body}
                  </div>
                )}
                {section.items && section.items.map((item, j) => (
                  <div key={j} style={{display:"flex",gap:10,marginBottom:10,paddingLeft:16}}>
                    <span style={{color:GREEN,fontWeight:900,flexShrink:0,marginTop:1}}>{i+1}.{j+1}</span>
                    <div style={{fontSize:14,color:MUTED,lineHeight:1.85}}>{item}</div>
                  </div>
                ))}
              </div>
            ))}

            <div style={{background:GOLD_BG,border:"1px solid "+GOLD,borderRadius:10,
              padding:20,marginTop:16,textAlign:"center"}}>
              <div style={{fontWeight:700,color:GREEN_DARK,marginBottom:6}}>
                © 2026 African Outreach Scholarship Program. All rights reserved.
              </div>
              <div style={{fontSize:13,color:MUTED}}>
                Powered by African Outreach Scholarship Foundation
              </div>
            </div>

            <div style={{textAlign:"center",marginTop:24,display:"flex",
              gap:12,justifyContent:"center",flexWrap:"wrap"}}>
              <button className="btn btn-green" onClick={()=>setView("apply")}>
                Accept &amp; Apply Now
              </button>
              <button className="btn" style={{background:"#F0F6F2",color:GREEN_DARK}}
                onClick={()=>setView("landing")}>
                Back to Home
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADMIN ────────────────────────────────────────────── */}
      {view==="admin" && !adminUnlocked && (
        <div style={{textAlign:"center",padding:"80px 24px"}}>
          <div style={{fontSize:48,marginBottom:16}}>🔒</div>
          <div style={{fontWeight:900,fontSize:20,color:GREEN_DARK,marginBottom:12}}>Admin Access Required</div>
          <button className="btn btn-green" onClick={()=>setModal("admin_login")}>Enter Admin Password</button>
        </div>
      )}

      {view==="admin" && adminUnlocked && (()=>{
        const allApplicants = Object.values(applicants);
        const activeCount = allApplicants.filter(a=>a.status==="active").length;
        const pendingCount = allApplicants.filter(a=>a.status==="pending").length;
        const totalBalance = allApplicants.reduce((s,a)=>s+a.balance,0);
        const totalEarned = allApplicants.reduce((s,a)=>s+a.totalEarned,0);
        const totalWithdrawn = allApplicants.reduce((s,a)=>s+a.totalWithdrawn,0);

        return (
          <div style={{maxWidth:1200,margin:"0 auto",padding:32}}>
            <div style={{background:GREEN_DARK,borderRadius:16,padding:24,color:WHITE,
              marginBottom:24,display:"flex",justifyContent:"space-between",
              alignItems:"center",flexWrap:"wrap",gap:12}}>
              <div>
                <div style={{fontSize:24,fontWeight:900}}>AOSP Admin Dashboard</div>
                <div style={{fontSize:13,color:"rgba(255,255,255,0.7)",marginTop:4}}>
                  African Outreach Scholarship Program — RoyalTech
                </div>
              </div>
              <button className="btn btn-sm" style={{background:"rgba(255,255,255,0.1)",color:WHITE}}
                onClick={()=>{setAdminUnlocked(false);setView("landing");}}>
                Lock &amp; Exit
              </button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:16,marginBottom:24}}>
              {[["Total Applicants",allApplicants.length],["Active",activeCount],
                ["Pending Donation",pendingCount],
                ["Total Earned",fmtUSD(totalEarned)],
                ["Total Balance",fmtUSD(totalBalance)],
                ["Total Withdrawn",fmtUSD(totalWithdrawn)],
              ].map(([label,val])=>(
                <div className="admin-stat" key={label}>
                  <div className="admin-stat-val">{val}</div>
                  <div className="admin-stat-label">{label}</div>
                </div>
              ))}
            </div>

            <div className="tabs">
              {[["applicants","All Applicants"],["pending","Pending Donation"],["withdrawals","Withdrawal Queue"]].map(([id,label])=>(
                <button key={id} className={"tab"+(adminTab===id?" active":"")}
                  onClick={async()=>{
                    setAdminTab(id);
                    if(id==="withdrawals"){
                      const w = await DB.getAllWithdrawals();
                      setAllWithdrawals(w);
                    }
                  }}>{label}</button>
              ))}
            </div>

            {adminTab==="applicants" && (
              <div className="table-wrap">
                <div className="table-head" style={{gridTemplateColumns:"1.5fr 1fr 1fr 1fr 1fr 1fr",display:"grid",gap:12}}>
                  <span>Applicant</span><span>Institution</span><span>Country</span>
                  <span>Balance</span><span>Total Earned</span><span>Status</span>
                </div>
                {allApplicants.length===0?(
                  <div style={{padding:32,textAlign:"center",color:MUTED}}>No applicants yet.</div>
                ):allApplicants.map(a=>(
                  <div key={a.refCode} className="table-row"
                    style={{gridTemplateColumns:"1.5fr 1fr 1fr 1fr 1fr 1fr",display:"grid",gap:12}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,color:GREEN_DARK}}>{a.fullName}</div>
                      <div style={{fontSize:11,color:MUTED}}>{a.email}</div>
                      <div style={{fontSize:11,color:MUTED}}>{a.phone}</div>
                      <div style={{fontSize:10,color:GREEN,fontWeight:700}}>{a.refCode}</div>
                    </div>
                    <div><div style={{fontSize:12,fontWeight:600}}>{a.institution}</div>
                      <div style={{fontSize:11,color:MUTED}}>{a.course}</div></div>
                    <div style={{fontSize:12}}>{a.country}</div>
                    <div style={{fontWeight:700,fontSize:13,color:GREEN_DARK}}>{fmtUSD(a.balance)}</div>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{fmtUSD(a.totalEarned)}</div>
                      <div style={{fontSize:11,color:MUTED}}>Cycle {a.linkCycle}</div>
                    </div>
                    <div>
                      <span className={"status-pill "+(a.status==="active"?"pill-active":"pill-pending")}>
                        {a.status==="active"?"Active":"Pending"}
                      </span>
                      {a.status==="active" && !a.linkActive && (
                        <div style={{fontSize:10,color:ERROR,marginTop:4,fontWeight:700}}>Link Inactive</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {adminTab==="pending" && (
              <div className="table-wrap">
                <div className="table-head" style={{gridTemplateColumns:"1.5fr 1fr 1fr 1fr 120px",display:"grid",gap:12}}>
                  <span>Applicant</span><span>Institution</span><span>Country</span>
                  <span>App Fee</span><span>Action</span>
                </div>
                {allApplicants.filter(a=>!a.appFeePaid).length===0?(
                  <div style={{padding:32,textAlign:"center",color:MUTED}}>No pending fees.</div>
                ):allApplicants.filter(a=>!a.appFeePaid).map(a=>(
                  <div key={a.refCode} className="table-row"
                    style={{gridTemplateColumns:"1.5fr 1fr 1fr 1fr 120px",display:"grid",gap:12,alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:13,color:GREEN_DARK}}>{a.fullName}</div>
                      <div style={{fontSize:11,color:MUTED}}>{a.email}</div>
                      <div style={{fontSize:11,color:MUTED}}>{a.phone}</div>
                      <div style={{fontSize:10,color:GREEN,fontWeight:700}}>{a.refCode}</div>
                    </div>
                    <div style={{fontSize:12,fontWeight:600}}>{a.institution}</div>
                    <div style={{fontSize:12}}>{a.country}</div>
                    <div style={{fontWeight:700}}>USD {APP_FEE_USD}.00</div>
                    <div>
                      <button className="btn btn-sm btn-green" style={{fontSize:11}}
                        onClick={async()=>{
                          await completeActivation(a.refCode,"bank_transfer","ADMIN-"+Date.now());
                          const fresh = await DB.getApplicants();
                          setApplicants(fresh);
                          showAlert("Activated: "+a.fullName);
                        }}>
                        Confirm Donation &amp; Activate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {adminTab==="withdrawals" && (
              <div className="table-wrap">
                <div className="table-head" style={{gridTemplateColumns:"1.5fr 1fr 1fr 1fr 120px",display:"grid",gap:12}}>
                  <span>Applicant</span><span>Amount (USD)</span><span>Amount (NGN)</span>
                  <span>Status</span><span>Action</span>
                </div>
                {allWithdrawals.length===0?(
                  <div style={{padding:32,textAlign:"center",color:MUTED}}>No withdrawal requests yet.</div>
                ):allWithdrawals.map(w=>{
                  const a = applicants[w.applicant_code];
                  return (
                    <div key={w.id} className="table-row"
                      style={{gridTemplateColumns:"1.5fr 1fr 1fr 1fr 120px",display:"grid",gap:12,alignItems:"center"}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:13,color:GREEN_DARK}}>{a?.fullName||w.applicant_code}</div>
                        <div style={{fontSize:11,color:MUTED}}>{a?.email}</div>
                        <div style={{fontSize:11,color:MUTED}}>{a?.accountName} | {a?.accountNumber}</div>
                        <div style={{fontSize:11,color:MUTED}}>{a?.accountBank} ({a?.accountCountry})</div>
                      </div>
                      <div style={{fontWeight:700,fontSize:14}}>{fmtUSD(Number(w.amount))}</div>
                      <div style={{fontSize:13,color:MUTED}}>{fmtNGN(Number(w.amount))}</div>
                      <div>
                        <span className={"status-pill "+(w.status==="processed"?"pill-processed":"pill-pending")}>
                          {w.status==="processed"?"Processed":"Pending"}
                        </span>
                        {w.status==="processed" && w.processed_at && (
                          <div style={{fontSize:10,color:MUTED,marginTop:4}}>
                            {new Date(w.processed_at).toLocaleDateString("en-GB")}
                          </div>
                        )}
                      </div>
                      <div>
                        {w.status!=="processed"?(
                          <button className="btn btn-sm btn-green" style={{fontSize:11}}
                            onClick={async()=>{
                              await DB.processWithdrawal(w.id);
                              const fresh = await DB.getAllWithdrawals();
                              setAllWithdrawals(fresh);
                              showAlert("Withdrawal processed for "+(a?.fullName||w.applicant_code));
                            }}>
                            Mark Processed
                          </button>
                        ):(
                          <span style={{fontSize:12,color:SUCCESS,fontWeight:700}}>✓ Done</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{textAlign:"center",marginTop:24}}>
              <button className="btn btn-green" onClick={()=>setView("landing")}>Back to Platform</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
