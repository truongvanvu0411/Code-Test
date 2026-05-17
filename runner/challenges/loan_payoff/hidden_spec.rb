require_relative "../implementation"

RSpec.describe LoanPayoffEngine do
  it "floors overpaid principal at zero and caps late fees" do
    result = described_class.new(
      [{ principal: 1000, annual_rate: 0.06, monthly_payment: 600, months_paid: 2, term_months: 12, late_days: 20 }],
      { score: 700 },
      { refinance: false }
    ).call

    expect(result[:remaining_principal]).to eq(0)
    expect(result[:late_fees]).to eq(120.0)
    expect(result[:early_discount]).to eq(0)
    expect(result[:service_tax]).to eq(12.0)
    expect(result[:final_total]).to eq(132.0)
  end
end
