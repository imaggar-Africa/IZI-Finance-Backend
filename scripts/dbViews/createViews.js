/**
 * scripts/dbViews/createViews.js
 * --------------------------------
 * Creates / recreates MongoDB views for reporting
 */

require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGO_URI;

const views = [
  {
    name: "repayment_summary_daily",
    viewOn: "transactions",
    pipeline: [
      {
        $group: {
          _id: {
            day: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
            }
          },
          totalAmount: { $sum: "$amount" },
          count: { $sum: 1 }
        }
      }
    ]
  },

  {
    name: "borrower_risk_scores",
    viewOn: "customers",
    pipeline: [
      {
        $project: {
          borrowerId: "$_id",
          creditScore: { $ifNull: ["$creditScore", 500] },
          riskLevel: {
            $cond: [{ $lt: ["$creditScore", 500] }, "HIGH", "LOW"]
          }
        }
      }
    ]
  },

  {
    name: "agent_performance_monthly",
    viewOn: "loans",
    pipeline: [
      {
        $group: {
          _id: {
            agentId: "$requestedByAgentId",
            month: {
              $dateToString: { format: "%Y-%m", date: "$createdAt" }
            }
          },
          loansHandled: { $sum: 1 },
          totalDisbursed: { $sum: "$amount" }
        }
      }
    ]
  },

  {
    name: "demographics_repayment_analysis",
    viewOn: "customers",
    pipeline: [
      {
        $lookup: {
          from: "loans",
          localField: "_id",
          foreignField: "borrowerId",
          as: "loans"
        }
      },
      {
        $group: {
          _id: "$gender",
          totalLoans: { $sum: { $size: "$loans" } }
        }
      }
    ]
  },

  {
    name: "regional_market_performance",
    viewOn: "loans",
    pipeline: [
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "borrower"
        }
      },
      { $unwind: "$borrower" },
      {
        $group: {
          _id: "$borrower.market",
          totalLoans: { $sum: 1 },
          totalDisbursed: { $sum: "$amount" }
        }
      }
    ]
  },

  {
    name: "business_category_performance",
    viewOn: "loans",
    pipeline: [
      {
        $lookup: {
          from: "customers",
          localField: "borrowerId",
          foreignField: "_id",
          as: "borrower"
        }
      },
      { $unwind: "$borrower" },
      {
        $group: {
          _id: "$borrower.occupation",
          loanCount: { $sum: 1 },
          totalDisbursed: { $sum: "$amount" }
        }
      }
    ]
  }
];

async function createViews() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Connected to DB");

    const db = mongoose.connection.db;

    for (const view of views) {
      const exists = await db
        .listCollections({ name: view.name })
        .toArray();

      if (exists.length > 0) {
        await db.collection(view.name).drop();
        console.log(`🗑️ Dropped ${view.name}`);
      }

      await db.createCollection(view.name, {
        viewOn: view.viewOn,
        pipeline: view.pipeline
      });

      console.log(`✅ ${view.name} created`);
    }

    console.log("🎉 All views created");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creating views:", err);
    process.exit(1);
  }
}

createViews();
