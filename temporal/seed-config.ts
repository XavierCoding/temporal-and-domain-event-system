/**
 * Seed script — creates the journey_config table and inserts Swiggy config.
 * Run with: npm run seed
 */
import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/journey",
});

const swiggyConfig = {
  client: "swiggy",
  stages: [
    "D1_location",
    "O1_app_download",
    "O2_si",
    "O3_payment",
    "O4_activation",
    "O5_first_order",
    "completed",
  ],
  stages_map: {
    D1_location: {
      on_enter: {
        action: "send_wa_template",
        template: "journey_update",
        replacements: ["We have a delivery partner opportunity for you! Please share your location to check openings near you."],
      },
      debounce_minutes: 2,
      nudge_ladder: [
        {
          wait_hours: 3,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Don't miss out! Share your location so we can find Swiggy openings near you."],
          },
        },
        {
          wait_hours: 24,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Openings are still available near you. Share your location to get started with Swiggy."],
          },
        },
        {
          wait_hours: 48,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Final reminder! Share your location to secure your Swiggy delivery partner spot."],
          },
          on_exhaust: { action: "trigger_voice_call" },
        },
      ],
      events: {
        location_shared: {
          next_stage: "O1_app_download",
          action: "send_wa_template",
          template: "journey_update",
          replacements: ["Great news! We found openings near you. Download the Swiggy Delivery app to apply."],
        },
        not_interested: { next_stage: "completed" },
      },
    },

    O1_app_download: {
      debounce_minutes: 2,
      nudge_ladder: [
        {
          wait_hours: 2,
          action_open: {
            action: "send_wa_message",
            replacements: ["Any questions about getting started with Swiggy? We are here to help you."],
          },
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Your Swiggy opportunity is ready! Download the app and start your application now."],
          },
        },
        {
          wait_hours: 24,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Still interested? Download the Swiggy Delivery app and complete your registration today."],
          },
        },
        {
          wait_hours: 48,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Final reminder — download the Swiggy app now and secure your delivery partner spot."],
          },
          on_exhaust: { action: "trigger_voice_call" },
        },
      ],
      events: {
        app_downloaded: {
          next_stage: "O2_si",
          action: "advance_langgraph_state",
          next_node: "handle_app_downloaded",
        },
        no_smartphone: { next_stage: "completed" },
        blocker_unresolvable: { next_stage: "completed" },
      },
    },

    O2_si: {
      on_enter: {
        action: "send_wa_template",
        template: "journey_update",
        replacements: ["Please keep your Aadhaar card and a selfie ready. These are all you need to complete document submission."],
      },
      debounce_minutes: 2,
      nudge_ladder: [
        {
          wait_hours: 3,
          action_open: {
            action: "send_wa_message",
            replacements: ["Need help with document submission? We are here to guide you through each step."],
          },
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Submit your Aadhaar and selfie to complete registration — no fees required at this step!"],
          },
        },
        {
          wait_hours: 24,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Your documents are still pending. Submit them now to move forward with your Swiggy registration."],
          },
        },
        {
          wait_hours: 48,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Last chance to submit your documents and join Swiggy. Complete this step to proceed."],
          },
          on_exhaust: { action: "trigger_voice_call" },
        },
      ],
      events: {
        si_filed: { next_stage: "O3_payment" },
        blocker_unresolvable: { next_stage: "completed" },
      },
    },

    O3_payment: {
      on_enter: {
        action: "send_wa_template",
        template: "journey_update",
        replacements: ["Almost there! Please complete the one-time registration payment to activate your Swiggy account."],
      },
      debounce_minutes: 2,
      nudge_ladder: [
        {
          wait_hours: 3,
          action_open: {
            action: "send_wa_message",
            replacements: ["Any questions about the registration payment? Our team is ready to assist you."],
          },
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Complete your one-time registration payment now and start earning with Swiggy!"],
          },
        },
        {
          wait_hours: 24,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Your Swiggy account is just one step away. Complete the registration payment to start delivering."],
          },
        },
        {
          wait_hours: 48,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Do not miss out! Complete your payment today and begin your Swiggy delivery partner journey."],
          },
          on_exhaust: { action: "trigger_voice_call" },
        },
      ],
      events: {
        payment_done: { next_stage: "O4_activation" },
        blocker_unresolvable: { next_stage: "completed" },
      },
    },

    O4_activation: {
      on_enter: {
        action: "send_wa_message",
        replacements: ["Your application is under review. We will notify you as soon as your account is activated."],
      },
      min_wait_hours: 6,
      debounce_minutes: 2,
      nudge_ladder: [
        {
          wait_hours: 6,
          action_open: {
            action: "send_wa_message",
            replacements: ["Your account activation is in progress. We will update you shortly."],
          },
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Your Swiggy account is being processed. We will let you know as soon as you are live!"],
          },
        },
        {
          wait_hours: 12,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Your activation is still in progress. Thank you for your patience — we will reach out soon."],
          },
          on_exhaust: { action: "trigger_voice_call" },
        },
      ],
      events: {
        activated: { next_stage: "O5_first_order" },
        blocker_unresolvable: { next_stage: "completed" },
      },
    },

    O5_first_order: {
      on_enter: {
        action: "send_wa_template",
        template: "journey_update",
        replacements: ["Congratulations! Your Swiggy account is now active. Open the app and accept your first delivery order to start earning."],
      },
      debounce_minutes: 2,
      demand_check_required: true,
      nudge_ladder: [
        {
          wait_hours: 12,
          action_open: {
            action: "send_wa_message",
            replacements: ["Ready to earn? Open the Swiggy app and accept your first delivery order today!"],
          },
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Your first delivery order is waiting! Open the Swiggy app and start earning right away."],
          },
        },
        {
          wait_hours: 24,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Your earnings are guaranteed by Swiggy. No need to worry — start with your first order today!"],
          },
        },
        {
          wait_hours: 48,
          action_closed: {
            action: "send_wa_template",
            template: "journey_update",
            replacements: ["Flexible hours and great earnings await you. Complete your first delivery with Swiggy now!"],
          },
          on_exhaust: { action: "trigger_voice_call" },
        },
      ],
      events: {
        fod: { next_stage: "completed" },
        got_better_job: { next_stage: "completed" },
        blocker_unresolvable: { next_stage: "completed" },
      },
    },
  },
};

async function seed(): Promise<void> {
  console.log("Creating journey_config table if not exists...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS journey_config (
      id         SERIAL PRIMARY KEY,
      client     VARCHAR NOT NULL,
      version    INT NOT NULL DEFAULT 1,
      config     JSONB NOT NULL,
      active     BOOLEAN DEFAULT TRUE,
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (client, version)
    )
  `);

  console.log("Creating leads table if not exists...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      phone          VARCHAR PRIMARY KEY,
      client         VARCHAR,
      journey_stage  VARCHAR,
      journey_status VARCHAR DEFAULT 'active',
      give_up_at     TIMESTAMP,
      created_at     TIMESTAMP DEFAULT NOW(),
      updated_at     TIMESTAMP DEFAULT NOW()
    )
  `);

  console.log("Inserting swiggy config...");
  await pool.query(
    `INSERT INTO journey_config (client, version, config, active)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (client, version) DO UPDATE SET config = $3, active = $4, updated_at = NOW()`,
    ["swiggy", 1, JSON.stringify(swiggyConfig), true]
  );

  console.log("Done — journey_config and leads tables seeded for swiggy (6 stages).");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
