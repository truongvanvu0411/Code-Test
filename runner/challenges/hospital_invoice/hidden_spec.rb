require_relative "../implementation"

RSpec.describe HospitalInvoiceEngine do
  it "caps patient responsibility before medication tax" do
    result = described_class.new(
      [{ base_price: 10_000, units: 1, emergency: true, doctor_grade: "senior" }],
      [{ price: 300, quantity: 2 }],
      { plan: "basic", in_network: false, deductible_remaining: 1000, max_out_of_pocket: 1200 }
    ).call

    expect(result[:procedure_total]).to eq(14375.0)
    expect(result[:medication_total]).to eq(600.0)
    expect(result[:network_discount]).to eq(0)
    expect(result[:patient_responsibility]).to eq(1200.0)
    expect(result[:final_total]).to eq(1230.0)
    expect(result[:audit_log]).to include("out of pocket cap")
  end
end
