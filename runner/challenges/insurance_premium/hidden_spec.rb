require_relative "../implementation"

RSpec.describe InsurancePremiumEngine do
  it "applies senior surcharge, employee benefit, and overseas tax" do
    result = described_class.new(
      [
        { insured_value: 50_000, plan: "basic", risk: "severe", age: 67, add_ons: { legal: true, flood: true } }
      ],
      { employee: true, no_claim_years: 0, region: "overseas" }
    ).call

    expect(result[:subtotal]).to eq(1267.8)
    expect(result[:discount]).to eq(20.0)
    expect(result[:tax]).to eq(149.74)
    expect(result[:final_total]).to eq(1397.54)
    expect(result[:audit_log]).to include("senior surcharge", "employee benefit")
  end
end
