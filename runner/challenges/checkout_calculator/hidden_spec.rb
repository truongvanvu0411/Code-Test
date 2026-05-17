require_relative "../implementation"

RSpec.describe CheckoutCalculator do
  it "does not apply SAVE25 below the discounted threshold" do
    result = described_class.new(
      [{ name: "Cable", price: 20, quantity: 3, category: "accessory", taxable: true }],
      { type: "normal", country: "US" },
      { coupon: "SAVE25", shipping_method: "standard" }
    ).call

    expect(result[:subtotal]).to eq(60.0)
    expect(result[:item_discount]).to eq(6.0)
    expect(result[:coupon_discount]).to eq(0)
    expect(result[:warnings]).to include("SAVE25 requires 100 minimum")
    expect(result[:final_total]).to eq(62.78)
  end

  it "caps gift card usage at the payable total" do
    result = described_class.new(
      [{ name: "Tablet", price: 100, quantity: 1, category: "electronics", taxable: true }],
      { type: "silver", country: "VN" },
      { gift_card: 500 }
    ).call

    expect(result[:final_total]).to eq(0)
    expect(result[:gift_used]).to eq(112.0)
  end
end
