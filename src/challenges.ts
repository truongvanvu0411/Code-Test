export type Challenge = {
  id: string;
  title: string;
  domain: string;
  durationMinutes: number;
  fileName: string;
  specFileName: string;
  businessRules: string[];
  rubric: string[];
  initialCode: string;
  visibleSpec: string;
};

export const CHALLENGES: Challenge[] = [
  {
    id: "rental_cart",
    title: "RentalCart Refactoring",
    domain: "Video rental checkout",
    durationMinutes: 30,
    fileName: "rental_cart.rb",
    specFileName: "rental_cart_spec.rb",
    businessRules: [
      "Regular videos cost 1,000 JPY for the first 2 days, then 300 JPY per extra day.",
      "New releases cost 400 JPY per day.",
      "Children videos cost 800 JPY for the first 3 days, then 200 JPY per extra day.",
      "Campaign mode gives 50% off each new release rental.",
      "Each rental earns 1 point, plus 1 bonus point for new releases rented for 2+ days.",
      "Rental days above 30 must raise RentalPeriodError.",
      "Receipt text and totals must keep the same behavior."
    ],
    rubric: [
      "Characterize behavior before changing structure.",
      "Refactor in small, verifiable steps.",
      "Separate pricing, point, and receipt responsibilities.",
      "Keep public API compatibility for the hidden specs."
    ],
    initialCode: `class Video
  REGULAR = :regular
  NEW_RELEASE = :new_release
  CHILDREN = :children

  attr_accessor :title, :price_code

  def initialize(title, price_code)
    @title = title
    @price_code = price_code
  end
end

class Rental
  attr_accessor :video, :days

  def initialize(video, days)
    @video = video
    @days = days
  end
end

class RentalCart
  class RentalPeriodError < StandardError; end

  attr_accessor :total_amount, :total_point, :receipt

  def initialize(campaign: false)
    @campaign = campaign
    @rentals = []
    @total_amount = 0
    @total_point = 0
    @receipt = "Receipt\\n"
  end

  def add_rental(rental)
    raise RentalPeriodError if rental.days > 30

    @rentals << rental
    update_total_amount(rental)
    update_total_point(rental)
    update_receipt(rental)
  end

  def update_total_amount(rental)
    amount = calculate_amount(rental)
    @total_amount += amount
  end

  def update_total_point(rental)
    point = 1
    if rental.video.price_code == Video::NEW_RELEASE
      if rental.days >= 2
        point += 1
      end
    end
    @total_point += point
  end

  def update_receipt(rental)
    @receipt += "#{rental.video.title}\\t#{rental.days} days\\t#{calculate_amount(rental)} JPY\\n"
  end

  def calculate_amount(rental)
    result = 0

    if rental.video.price_code == Video::REGULAR
      result += 1000
      if rental.days > 2
        result += (rental.days - 2) * 300
      end
    else
      if rental.video.price_code == Video::NEW_RELEASE
        result += rental.days * 400
        if @campaign
          result = (result * 0.5).to_i
        end
      else
        if rental.video.price_code == Video::CHILDREN
          result += 800
          if rental.days > 3
            result += (rental.days - 3) * 200
          end
        end
      end
    end

    result
  end

  def statement
    output = @receipt
    output += "Total amount: #{@total_amount} JPY\\n"
    output += "Total point: #{@total_point}"
    output
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe RentalCart do
  it "calculates a mixed rental cart" do
    cart = RentalCart.new(campaign: false)

    cart.add_rental(Rental.new(Video.new("Matrix", Video::REGULAR), 3))
    cart.add_rental(Rental.new(Video.new("Dune 2", Video::NEW_RELEASE), 2))
    cart.add_rental(Rental.new(Video.new("Totoro", Video::CHILDREN), 4))

    expect(cart.total_amount).to eq(3100)
    expect(cart.total_point).to eq(4)
    expect(cart.statement).to include("Matrix\\t3 days\\t1300 JPY")
    expect(cart.statement).to include("Total amount: 3100 JPY")
  end
end
`
  },
  {
    id: "checkout_calculator",
    title: "CheckoutCalculator Refactoring",
    domain: "Retail checkout discounts and tax",
    durationMinutes: 30,
    fileName: "checkout_calculator.rb",
    specFileName: "checkout_calculator_spec.rb",
    businessRules: [
      "Accessory items get 10% off when quantity is 3 or more.",
      "Electronics items get a flat 15 USD discount when quantity is 2 or more.",
      "Gold members receive 8% off after item discounts.",
      "SAVE25 applies after item discounts when the discounted subtotal is at least 100.",
      "VN tax is 10% on taxable items after prorated item discounts.",
      "Gift cards reduce the payable total after tax and shipping."
    ],
    rubric: [
      "Protect calculation order with examples.",
      "Extract discount and tax concepts without changing public result keys.",
      "Avoid broad rewrites that make hidden edge cases risky.",
      "Document remaining risks in the final summary."
    ],
    initialCode: `class CheckoutCalculator
  def initialize(items, customer = {}, options = {})
    @items = items || []
    @customer = customer || {}
    @options = options || {}
    @warnings = []
    @audit = []
  end

  def call
    return { error: ["Empty basket"], status: :failure } if @items.empty?

    customer_type = (@customer[:type] || "normal").to_s.downcase
    country = (@customer[:country] || "US").to_s.upcase
    raw_subtotal = 0
    item_discount = 0

    @items.each do |item|
      item[:price] = item[:price].to_f
      item[:quantity] = item[:quantity].to_i
      item[:category] = (item[:category] || "general").to_s.downcase
      next if item[:quantity] <= 0

      line_total = item[:price] * item[:quantity]
      raw_subtotal += line_total

      if item[:category] == "electronics"
        if item[:quantity] >= 2
          item_discount += 15.0
          @audit << "electronics bulk"
        end
      end

      if item[:category] == "accessory"
        if item[:quantity] >= 3
          item_discount += (line_total * 0.10).round(2)
          @audit << "accessory bulk"
        end
      end
    end

    membership_discount = 0
    balance = raw_subtotal - item_discount
    if customer_type == "gold"
      membership_discount = (balance * 0.08).round(2)
    elsif customer_type == "silver"
      membership_discount = (balance * 0.03).round(2)
    end

    coupon_discount = 0
    if (@options[:coupon] || "").to_s.upcase == "SAVE25"
      if balance >= 100
        coupon_discount = 25.0
      else
        @warnings << "SAVE25 requires 100 minimum"
      end
    end

    tax_base = 0
    @items.each do |item|
      next if item[:quantity].to_i <= 0
      next if item[:taxable] == false

      line_total = item[:price] * item[:quantity]
      ratio = line_total / raw_subtotal
      tax_base += line_total - (item_discount * ratio)
    end

    tax_rate = country == "VN" ? 0.10 : 0.07
    tax = (tax_base * tax_rate).round(2)
    shipping = @options[:shipping_method] == "express" ? 15.0 : 5.0
    total_before_gift = raw_subtotal - item_discount - membership_discount - coupon_discount + tax + shipping
    gift_used = [[(@options[:gift_card] || 0).to_f, total_before_gift].min, 0].max
    final_total = (total_before_gift - gift_used).round(2)

    {
      subtotal: raw_subtotal,
      item_discount: item_discount,
      membership_discount: membership_discount,
      coupon_discount: coupon_discount,
      tax: tax,
      shipping: shipping,
      gift_used: gift_used,
      final_total: final_total,
      audit_log: @audit,
      warnings: @warnings
    }
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe CheckoutCalculator do
  it "keeps checkout totals stable for a gold VN customer" do
    items = [
      { name: "Monitor", price: 120, quantity: 2, category: "electronics", taxable: true },
      { name: "Mouse", price: 35, quantity: 4, category: "accessory", taxable: true },
      { name: "Book", price: 18, quantity: 5, category: "books", taxable: false }
    ]

    result = described_class.new(
      items,
      { type: "Gold", country: "VN" },
      { coupon: "SAVE25", shipping_method: "express", gift_card: 50 }
    ).call

    expect(result[:subtotal]).to eq(470.0)
    expect(result[:item_discount]).to eq(29.0)
    expect(result[:membership_discount]).to eq(35.28)
    expect(result[:tax]).to eq(35.66)
    expect(result[:final_total]).to eq(381.38)
  end
end
`
  },
  {
    id: "saas_billing",
    title: "BillingEngine Refactoring",
    domain: "SaaS subscription invoice",
    durationMinutes: 30,
    fileName: "billing_engine.rb",
    specFileName: "billing_engine_spec.rb",
    businessRules: [
      "Plans have base fee, seat fee, included seats, and included storage.",
      "Seats above the included limit are charged at 1.5x the regular seat fee.",
      "20+ seats receive 10% off seat subtotal; 100+ seats receive 20%.",
      "Annual billing gives 15% off gross subtotal before referral credit.",
      "Referral credit is capped so invoice cannot go below zero before tax.",
      "Tax is based on the region after discounts and credits."
    ],
    rubric: [
      "Make plan, usage, discount, and tax logic easier to reason about.",
      "Preserve result keys used by downstream invoice code.",
      "Add examples before restructuring high-risk calculations.",
      "Keep refactor incremental and observable."
    ],
    initialCode: `class BillingEngine
  def initialize(account_id, plan_id, usage_data = [], settings = {})
    @account_id = account_id
    @plan_id = plan_id.to_s.downcase
    @usage = usage_data || []
    @settings = settings || {}
    @log = []
  end

  def call
    plans = {
      "basic" => { base: 29.0, seat: 12.0, limit: 5, storage: 10 },
      "pro" => { base: 99.0, seat: 25.0, limit: 50, storage: 100 },
      "enterprise" => { base: 499.0, seat: 45.0, limit: 1000, storage: 1000 }
    }

    plan = plans[@plan_id] || plans["basic"]
    seats = @settings[:seats].to_i

    if seats > plan[:limit]
      overage = seats - plan[:limit]
      seat_subtotal = (plan[:limit] * plan[:seat]) + (overage * plan[:seat] * 1.5)
      @log << "seat overage"
    else
      seat_subtotal = seats * plan[:seat]
    end

    if seats >= 100
      seat_subtotal -= (seat_subtotal * 0.20).round(2)
    elsif seats >= 20
      seat_subtotal -= (seat_subtotal * 0.10).round(2)
    end

    storage_used = @usage.sum { |u| u[:storage_gb] || 0 }
    storage_fee = 0
    if storage_used > plan[:storage]
      storage_fee = ((storage_used - plan[:storage]) * 0.5).round(2)
    end

    api_calls = @usage.sum { |u| u[:api_calls] || 0 }
    api_fee = 0
    if api_calls > 10_000
      api_fee = ((api_calls - 10_000) * 0.001).round(2)
    end

    addon_total = 0
    if @settings[:support_tier] == "priority"
      addon_total += 50.0
    elsif @settings[:support_tier] == "dedicated"
      addon_total += 250.0
    end

    if @settings[:security_bundle]
      addon_total += seats * 2.0
    end

    gross_subtotal = plan[:base] + seat_subtotal + storage_fee + api_fee + addon_total
    annual_discount = @settings[:billing_cycle] == "annual" ? (gross_subtotal * 0.15).round(2) : 0
    referral_credit = @settings[:referral_active] ? 100.0 : 0
    referral_credit = [referral_credit, gross_subtotal - annual_discount].min

    region = (@settings[:region] || "global").downcase
    tax_rate = region == "eu-west" ? 0.20 : region == "na-us" ? 0.075 : 0.05
    taxable_total = gross_subtotal - annual_discount - referral_credit
    tax = (taxable_total * tax_rate).round(2)

    {
      subtotal: gross_subtotal.round(2),
      item_discount: annual_discount,
      membership_discount: referral_credit,
      tax: tax,
      final_total: (taxable_total + tax).round(2),
      audit_log: @log,
      warn: seats > plan[:limit] ? "Seat limit breach" : nil
    }
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe BillingEngine do
  it "calculates a pro annual invoice with overages" do
    result = described_class.new(
      "ACC-9981",
      "pro",
      [{ storage_gb: 150, api_calls: 50_000 }],
      { seats: 60, support_tier: "priority", billing_cycle: "annual", security_bundle: true, region: "eu-west", referral_active: true }
    ).call

    expect(result[:subtotal]).to eq(1796.5)
    expect(result[:item_discount]).to eq(269.47)
    expect(result[:membership_discount]).to eq(100.0)
    expect(result[:tax]).to eq(285.41)
    expect(result[:final_total]).to eq(1712.44)
  end
end
`
  },
  {
    id: "insurance_premium",
    title: "InsurancePremiumEngine Refactoring",
    domain: "Insurance policy pricing",
    durationMinutes: 30,
    fileName: "insurance_premium_engine.rb",
    specFileName: "insurance_premium_engine_spec.rb",
    businessRules: [
      "Each policy is priced from insured value, plan rate, risk level, age, and add-ons.",
      "Portfolio discount applies when a customer has 3 or more policies.",
      "No-claim discount applies after the portfolio discount.",
      "Employee benefit is a flat discount after percentage discounts.",
      "Tax rate depends on customer region.",
      "Final result must keep audit, warning, and pricing keys stable."
    ],
    rubric: [
      "Make rate tables and discount order explicit.",
      "Separate policy line calculation from customer-level adjustments.",
      "Preserve rounding behavior at each legacy step.",
      "Add tests for discount ordering and regional tax."
    ],
    initialCode: `class InsurancePremiumEngine
  def initialize(policies, customer = {})
    @policies = policies || []
    @customer = customer || {}
    @audit = []
    @warnings = []
  end

  def call
    return { error: "no policies", status: :failure } if @policies.empty?

    subtotal = 0
    @policies.each do |policy|
      value = policy[:insured_value].to_f
      plan = (policy[:plan] || "basic").to_s
      risk = (policy[:risk] || "standard").to_s
      age = policy[:age].to_i
      add_ons = policy[:add_ons] || {}

      rate = plan == "elite" ? 0.026 : plan == "plus" ? 0.018 : 0.012
      line = value * rate

      if risk == "low"
        line = line * 0.90
      elsif risk == "high"
        line = line * 1.25
      elsif risk == "severe"
        line = line * 1.60
      end

      if age > 65
        line += line * 0.18
        @audit << "senior surcharge"
      elsif age > 0 && age < 25
        line += line * 0.08
        @audit << "young driver surcharge"
      end

      line += 35.0 if add_ons[:theft]
      line += (value * 0.0015) if add_ons[:flood]
      line += 60.0 if add_ons[:legal]

      if value <= 0
        @warnings << "policy with missing insured value"
      end

      subtotal += line.round(2)
    end

    discount = 0
    if @policies.size >= 3
      discount += (subtotal * 0.07).round(2)
      @audit << "portfolio discount"
    end

    if @customer[:no_claim_years].to_i >= 5
      discount += ((subtotal - discount) * 0.05).round(2)
      @audit << "no claim discount"
    end

    if @customer[:employee]
      discount += 20.0
      @audit << "employee benefit"
    end

    region = (@customer[:region] || "domestic").to_s
    tax_rate = region == "overseas" ? 0.12 : region == "coastal" ? 0.09 : region == "urban" ? 0.08 : 0.05
    taxable = subtotal - discount
    tax = (taxable * tax_rate).round(2)

    {
      subtotal: subtotal.round(2),
      discount: discount.round(2),
      tax: tax,
      final_total: (taxable + tax).round(2),
      audit_log: @audit,
      warnings: @warnings
    }
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe InsurancePremiumEngine do
  it "prices a portfolio with ordered discounts and coastal tax" do
    policies = [
      { insured_value: 80_000, plan: "plus", risk: "high", age: 45, add_ons: { theft: true, flood: true } },
      { insured_value: 25_000, plan: "basic", risk: "low", age: 22, add_ons: { legal: true } },
      { insured_value: 150_000, plan: "elite", risk: "standard", age: 70, add_ons: {} }
    ]

    result = described_class.new(policies, { no_claim_years: 5, region: "coastal" }).call

    expect(result[:subtotal]).to eq(6908.6)
    expect(result[:discount]).to eq(804.85)
    expect(result[:tax]).to eq(549.34)
    expect(result[:final_total]).to eq(6653.09)
  end
end
`
  },
  {
    id: "payroll_adjustment",
    title: "PayrollAdjustmentEngine Refactoring",
    domain: "Monthly payroll and deductions",
    durationMinutes: 30,
    fileName: "payroll_adjustment_engine.rb",
    specFileName: "payroll_adjustment_engine_spec.rb",
    businessRules: [
      "Hourly employees receive overtime after 40 hours at 1.5x.",
      "Managers receive a fixed responsibility allowance.",
      "Weekend shifts add a fixed allowance per shift.",
      "December payroll adds a 3% holiday allowance to gross pay.",
      "Contractors are excluded from benefit deductions.",
      "Regional income tax is calculated after the holiday allowance."
    ],
    rubric: [
      "Extract employee gross pay from payroll-level deductions.",
      "Protect contractor and non-contractor behavior with specs.",
      "Keep rounding compatible with the legacy result.",
      "Avoid comments that restate obvious code."
    ],
    initialCode: `class PayrollAdjustmentEngine
  def initialize(employees, settings = {})
    @employees = employees || []
    @settings = settings || {}
    @audit = []
  end

  def call
    gross = 0
    benefit_base = 0

    @employees.each do |employee|
      rate = employee[:hourly_rate].to_f
      hours = employee[:hours].to_f
      role = (employee[:role] || "staff").to_s
      bonuses = employee[:bonuses] || []
      weekend_shifts = employee[:weekend_shifts].to_i

      line = 0
      if hours > 40
        line += 40 * rate
        line += (hours - 40) * rate * 1.5
        @audit << "overtime"
      else
        line += hours * rate
      end

      line += 150.0 if role == "manager"
      line += weekend_shifts * 35.0
      line += bonuses.sum { |bonus| bonus.to_f }

      gross += line.round(2)
      benefit_base += line.round(2) unless employee[:contractor]
    end

    holiday_allowance = 0
    if @settings[:month].to_s.downcase == "december"
      holiday_allowance = (gross * 0.03).round(2)
      @audit << "holiday allowance"
    end

    benefits = (benefit_base * 0.08).round(2)
    region = (@settings[:region] || "global").to_s
    tax_rate = region == "jp" ? 0.1021 : region == "vn" ? 0.10 : 0.12
    taxable = gross + holiday_allowance
    tax = (taxable * tax_rate).round(2)
    net_pay = (taxable - benefits - tax).round(2)

    {
      gross: gross.round(2),
      holiday_allowance: holiday_allowance,
      benefits: benefits,
      tax: tax,
      net_pay: net_pay,
      audit_log: @audit
    }
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe PayrollAdjustmentEngine do
  it "calculates december payroll with overtime and contractor exclusion" do
    employees = [
      { hourly_rate: 30, hours: 45, role: "engineer", weekend_shifts: 2, bonuses: [200], contractor: false },
      { hourly_rate: 50, hours: 38, role: "manager", weekend_shifts: 0, bonuses: [500], contractor: false },
      { hourly_rate: 80, hours: 20, role: "consultant", weekend_shifts: 0, bonuses: [], contractor: true }
    ]

    result = described_class.new(employees, { month: "december", region: "jp" }).call

    expect(result[:gross]).to eq(5845.0)
    expect(result[:holiday_allowance]).to eq(175.35)
    expect(result[:benefits]).to eq(339.6)
    expect(result[:tax]).to eq(614.68)
    expect(result[:net_pay]).to eq(5066.07)
  end
end
`
  },
  {
    id: "airline_fare",
    title: "AirlineFareEngine Refactoring",
    domain: "Airline itinerary pricing",
    durationMinutes: 30,
    fileName: "airline_fare_engine.rb",
    specFileName: "airline_fare_engine_spec.rb",
    businessRules: [
      "Each leg combines base fare, distance charge, cabin multiplier, peak multiplier, and international surcharge.",
      "One bag per passenger is free; extra bags are charged.",
      "Seat selection is charged per passenger.",
      "Loyalty discount applies before promo code.",
      "International airport fees are charged per passenger per international leg.",
      "Tax applies after loyalty and promo discounts but before airport fees."
    ],
    rubric: [
      "Make fare leg pricing testable in isolation.",
      "Preserve discount ordering across loyalty and promo rules.",
      "Add examples for international fees and baggage edge cases.",
      "Keep public return keys stable."
    ],
    initialCode: `class AirlineFareEngine
  def initialize(legs, passengers, options = {})
    @legs = legs || []
    @passengers = passengers.to_i
    @options = options || {}
    @audit = []
  end

  def call
    fare_subtotal = 0
    international_legs = 0

    @legs.each do |leg|
      base = leg[:base].to_f
      distance = leg[:distance].to_f
      cabin = (leg[:cabin] || "economy").to_s

      line = base + (distance * 0.06)
      if cabin == "business"
        line = line * 1.8
      elsif cabin == "first"
        line = line * 2.6
      end

      if leg[:peak]
        line = line * 1.12
        @audit << "peak multiplier"
      end

      if leg[:international]
        line += 45.0
        international_legs += 1
      end

      fare_subtotal += line.round(2)
    end

    extra_bags = [@options[:bags].to_i - @passengers, 0].max
    baggage_fee = extra_bags * 35.0
    seat_fee = @options[:seat_selection] ? @passengers * 12.0 : 0
    gross = fare_subtotal + baggage_fee + seat_fee

    loyalty = (@options[:loyalty] || "none").to_s
    loyalty_discount = 0
    if loyalty == "gold"
      loyalty_discount = (gross * 0.08).round(2)
    elsif loyalty == "silver"
      loyalty_discount = (gross * 0.04).round(2)
    end

    promo_discount = 0
    if (@options[:promo] || "").to_s.upcase == "FLY50" && gross > 400
      promo_discount = 50.0
    end

    taxable = gross - loyalty_discount - promo_discount
    tax = (taxable * 0.07).round(2)
    airport_fee = international_legs * @passengers * 18.0

    {
      fare_subtotal: fare_subtotal.round(2),
      baggage_fee: baggage_fee,
      seat_fee: seat_fee,
      loyalty_discount: loyalty_discount,
      promo_discount: promo_discount,
      tax: tax,
      airport_fee: airport_fee,
      final_total: (taxable + tax + airport_fee).round(2),
      audit_log: @audit
    }
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe AirlineFareEngine do
  it "prices a mixed domestic and international itinerary" do
    legs = [
      { base: 100, distance: 500, cabin: "economy", peak: true, international: false },
      { base: 220, distance: 2500, cabin: "business", peak: false, international: true }
    ]

    result = described_class.new(legs, 2, { bags: 3, seat_selection: true, loyalty: "gold", promo: "FLY50" }).call

    expect(result[:fare_subtotal]).to eq(856.6)
    expect(result[:baggage_fee]).to eq(35.0)
    expect(result[:loyalty_discount]).to eq(73.25)
    expect(result[:tax]).to eq(55.46)
    expect(result[:final_total]).to eq(883.81)
  end
end
`
  },
  {
    id: "property_commission",
    title: "PropertyCommissionEngine Refactoring",
    domain: "Real estate commission settlement",
    durationMinutes: 30,
    fileName: "property_commission_engine.rb",
    specFileName: "property_commission_engine_spec.rb",
    businessRules: [
      "Residential commission is tiered: 3% for the first 500k, 2% above that.",
      "Commercial and land deals use flat commission rates.",
      "Luxury residential deals above 1M receive an additional 0.2%.",
      "Co-broker deals split gross commission before agent split.",
      "Referral fee is 15% of the agent commission.",
      "Company tax is calculated after marketing spend."
    ],
    rubric: [
      "Extract commission rate and split concepts.",
      "Protect tier and co-broker behavior with specs.",
      "Keep gross, agent, and company numbers explainable.",
      "Avoid hiding business rules behind clever abstractions."
    ],
    initialCode: `class PropertyCommissionEngine
  def initialize(deal, settings = {})
    @deal = deal || {}
    @settings = settings || {}
    @audit = []
  end

  def call
    price = @deal[:price].to_f
    property_type = (@deal[:property_type] || "residential").to_s

    gross_commission = 0
    if property_type == "residential"
      first_tier = [price, 500_000].min
      gross_commission += first_tier * 0.03
      if price > 500_000
        gross_commission += (price - 500_000) * 0.02
      end
      if price > 1_000_000
        gross_commission += price * 0.002
        @audit << "luxury kicker"
      end
    elsif property_type == "commercial"
      gross_commission = price * 0.025
    else
      gross_commission = price * 0.018
    end

    if @deal[:co_broker]
      gross_commission = gross_commission / 2.0
      @audit << "co broker split"
    end

    level = (@settings[:agent_level] || "junior").to_s
    split = level == "lead" ? 0.75 : level == "senior" ? 0.70 : 0.60
    agent_commission = (gross_commission * split).round(2)
    referral_fee = @deal[:referral] ? (agent_commission * 0.15).round(2) : 0
    agent_net = agent_commission - referral_fee

    company_commission = (gross_commission - agent_commission).round(2)
    marketing_spend = @settings[:marketing_spend].to_f
    company_taxable = company_commission - marketing_spend
    company_tax = (company_taxable * 0.10).round(2)

    {
      gross_commission: gross_commission.round(2),
      agent_commission: agent_commission,
      referral_fee: referral_fee,
      agent_net: agent_net.round(2),
      company_commission: company_commission,
      company_tax: company_tax,
      company_final: (company_taxable + company_tax).round(2),
      audit_log: @audit
    }
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe PropertyCommissionEngine do
  it "settles a residential deal with referral and marketing spend" do
    result = described_class.new(
      { price: 850_000, property_type: "residential", co_broker: false, referral: true },
      { agent_level: "senior", marketing_spend: 2000 }
    ).call

    expect(result[:gross_commission]).to eq(22000.0)
    expect(result[:agent_commission]).to eq(15400.0)
    expect(result[:referral_fee]).to eq(2310.0)
    expect(result[:agent_net]).to eq(13090.0)
    expect(result[:company_final]).to eq(5060.0)
  end
end
`
  },
  {
    id: "warehouse_fulfillment",
    title: "WarehouseFulfillmentEngine Refactoring",
    domain: "3PL fulfillment billing",
    durationMinutes: 30,
    fileName: "warehouse_fulfillment_engine.rb",
    specFileName: "warehouse_fulfillment_engine_spec.rb",
    businessRules: [
      "Picking, packing, weight, cold-chain, insurance, SLA, and distance fees are combined.",
      "Fragile items increase packing fees.",
      "Cold-chain items add per-unit cold handling fees.",
      "Monthly volume discount applies only to handling fees.",
      "Priority client discount applies after the volume discount.",
      "Tax is calculated after all discounts."
    ],
    rubric: [
      "Separate item handling from shipment-level fees.",
      "Protect discount base calculations with specs.",
      "Keep fee names visible in the result hash.",
      "Use clear objects or methods without over-engineering."
    ],
    initialCode: `class WarehouseFulfillmentEngine
  def initialize(orders, account = {})
    @orders = orders || []
    @account = account || {}
    @audit = []
  end

  def call
    pick_fee = 0
    pack_fee = 0
    weight_fee = 0
    cold_fee = 0
    insurance_fee = 0
    sla_fee = 0
    distance_fee = 0

    @orders.each do |order|
      pack_fee += 4.0
      total_weight = 0
      total_value = 0

      (order[:items] || []).each do |item|
        quantity = item[:quantity].to_i
        pick_fee += quantity * 1.2
        total_weight += quantity * item[:weight].to_f
        total_value += item[:value].to_f
        pack_fee += quantity * 2.0 if item[:fragile]
        cold_fee += quantity * 1.8 if item[:temperature] == "cold"
      end

      weight_fee += total_weight * 0.7
      insurance_fee += total_value > 500 ? (total_value * 0.01) : 0
      sla_fee += order[:sla] == "same_day" ? 28.0 : order[:sla] == "express" ? 15.0 : 0
      distance = order[:distance_km].to_f
      distance_fee += (distance - 50) * 0.3 if distance > 50
    end

    handling_fee = pick_fee + pack_fee + weight_fee + cold_fee
    subtotal = handling_fee + insurance_fee + sla_fee + distance_fee
    discount = 0

    if @account[:monthly_volume].to_i > 500
      discount += (handling_fee * 0.12).round(2)
      @audit << "volume discount"
    end

    if @account[:priority_client]
      discount += ((subtotal - discount) * 0.05).round(2)
      @audit << "priority discount"
    end

    tax = ((subtotal - discount) * 0.08).round(2)

    {
      handling_fee: handling_fee.round(2),
      insurance_fee: insurance_fee.round(2),
      sla_fee: sla_fee,
      distance_fee: distance_fee.round(2),
      discount: discount.round(2),
      tax: tax,
      final_total: (subtotal - discount + tax).round(2),
      audit_log: @audit
    }
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe WarehouseFulfillmentEngine do
  it "calculates fulfillment fees with volume and priority discounts" do
    orders = [
      {
        sla: "express",
        distance_km: 80,
        items: [
          { quantity: 10, weight: 0.5, fragile: false, temperature: "ambient", value: 100 },
          { quantity: 2, weight: 3, fragile: true, temperature: "cold", value: 800 }
        ]
      }
    ]

    result = described_class.new(orders, { monthly_volume: 600, priority_client: true }).call

    expect(result[:handling_fee]).to eq(33.7)
    expect(result[:insurance_fee]).to eq(9.0)
    expect(result[:discount]).to eq(7.17)
    expect(result[:tax]).to eq(4.76)
    expect(result[:final_total]).to eq(64.29)
  end
end
`
  },
  {
    id: "hospital_invoice",
    title: "HospitalInvoiceEngine Refactoring",
    domain: "Hospital patient invoice",
    durationMinutes: 30,
    fileName: "hospital_invoice_engine.rb",
    specFileName: "hospital_invoice_engine_spec.rb",
    businessRules: [
      "Procedures combine base price, unit count, emergency uplift, and doctor grade uplift.",
      "In-network patients receive a 10% network discount on gross charges.",
      "Insurance plan determines covered percentage after network discount.",
      "Remaining deductible is added to patient responsibility.",
      "Medication tax is charged separately.",
      "Max out-of-pocket cap limits patient responsibility before medication tax."
    ],
    rubric: [
      "Separate clinical line items from payer responsibility.",
      "Protect deductible and cap ordering.",
      "Keep healthcare terminology clear in method names.",
      "Avoid broad rewrites before characterization specs exist."
    ],
    initialCode: `class HospitalInvoiceEngine
  def initialize(procedures, medications, patient = {})
    @procedures = procedures || []
    @medications = medications || []
    @patient = patient || {}
    @audit = []
  end

  def call
    procedure_total = 0
    @procedures.each do |procedure|
      line = procedure[:base_price].to_f * procedure[:units].to_i
      if procedure[:emergency]
        line += line * 0.25
        @audit << "emergency uplift"
      end
      line += line * 0.15 if procedure[:doctor_grade] == "senior"
      procedure_total += line.round(2)
    end

    medication_total = @medications.sum { |medication| medication[:price].to_f * medication[:quantity].to_i }
    gross = procedure_total + medication_total
    network_discount = @patient[:in_network] ? (gross * 0.10).round(2) : 0
    eligible = gross - network_discount

    plan = (@patient[:plan] || "standard").to_s
    coverage = plan == "premium" ? 0.85 : plan == "basic" ? 0.55 : 0.70
    patient_responsibility = (eligible * (1 - coverage)).round(2)
    patient_responsibility += @patient[:deductible_remaining].to_f

    max_out = @patient[:max_out_of_pocket]
    if max_out && patient_responsibility > max_out.to_f
      patient_responsibility = max_out.to_f
      @audit << "out of pocket cap"
    end

    medication_tax = (medication_total * 0.05).round(2)

    {
      procedure_total: procedure_total.round(2),
      medication_total: medication_total.round(2),
      network_discount: network_discount,
      patient_responsibility: patient_responsibility.round(2),
      medication_tax: medication_tax,
      final_total: (patient_responsibility + medication_tax).round(2),
      audit_log: @audit
    }
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe HospitalInvoiceEngine do
  it "calculates insured patient responsibility with deductible and medication tax" do
    procedures = [
      { base_price: 500, units: 1, emergency: false, doctor_grade: "senior" },
      { base_price: 2000, units: 1, emergency: true, doctor_grade: "regular" }
    ]
    medications = [
      { price: 120, quantity: 1 },
      { price: 40, quantity: 2 }
    ]

    result = described_class.new(
      procedures,
      medications,
      { plan: "premium", in_network: true, deductible_remaining: 300, max_out_of_pocket: 900 }
    ).call

    expect(result[:procedure_total]).to eq(3075.0)
    expect(result[:medication_total]).to eq(200.0)
    expect(result[:network_discount]).to eq(327.5)
    expect(result[:patient_responsibility]).to eq(742.13)
    expect(result[:final_total]).to eq(752.13)
  end
end
`
  },
  {
    id: "loan_payoff",
    title: "LoanPayoffEngine Refactoring",
    domain: "Loan settlement and payoff",
    durationMinutes: 30,
    fileName: "loan_payoff_engine.rb",
    specFileName: "loan_payoff_engine_spec.rb",
    businessRules: [
      "Remaining principal is calculated from scheduled payments minus accrued simple interest.",
      "Late fee is capped per loan.",
      "High-score borrowers receive early payoff discount when more than 12 months remain.",
      "Refinance mode adds a fixed processing fee.",
      "Service tax applies to late and processing fees only.",
      "Negative remaining principal is floored at zero."
    ],
    rubric: [
      "Isolate loan-level payoff math from borrower-level fees.",
      "Protect cap, floor, and discount rules with specs.",
      "Keep legacy simple-interest behavior intact.",
      "Make calculation order readable for reviewers."
    ],
    initialCode: `class LoanPayoffEngine
  def initialize(loans, borrower = {}, options = {})
    @loans = loans || []
    @borrower = borrower || {}
    @options = options || {}
    @audit = []
  end

  def call
    remaining_principal = 0
    late_fees = 0
    early_discount = 0

    @loans.each do |loan|
      principal = loan[:principal].to_f
      monthly_rate = loan[:annual_rate].to_f / 12.0
      months_paid = loan[:months_paid].to_i
      scheduled_paid = loan[:monthly_payment].to_f * months_paid
      accrued_interest = principal * monthly_rate * months_paid
      remaining = principal - (scheduled_paid - accrued_interest)
      remaining = 0 if remaining < 0
      remaining_principal += remaining.round(2)

      late_fee = [loan[:late_days].to_i * 8.0, 120.0].min
      late_fees += late_fee

      remaining_months = loan[:term_months].to_i - months_paid
      if @borrower[:score].to_i > 750 && remaining_months > 12
        early_discount += (remaining * 0.01).round(2)
        @audit << "early payoff discount"
      end
    end

    processing_fee = @options[:refinance] ? 150.0 : 0
    service_tax = ((late_fees + processing_fee) * 0.10).round(2)
    final_total = remaining_principal + late_fees + processing_fee - early_discount + service_tax

    {
      remaining_principal: remaining_principal.round(2),
      late_fees: late_fees.round(2),
      early_discount: early_discount.round(2),
      processing_fee: processing_fee,
      service_tax: service_tax,
      final_total: final_total.round(2),
      audit_log: @audit
    }
  end
end
`,
    visibleSpec: `require_relative "../implementation"

RSpec.describe LoanPayoffEngine do
  it "calculates payoff with late fees, refinance fee, and early discount" do
    loans = [
      { principal: 10_000, annual_rate: 0.12, monthly_payment: 500, months_paid: 6, term_months: 24, late_days: 4 },
      { principal: 5_000, annual_rate: 0.09, monthly_payment: 300, months_paid: 3, term_months: 12, late_days: 0 }
    ]

    result = described_class.new(loans, { score: 780 }, { refinance: true }).call

    expect(result[:remaining_principal]).to eq(11812.5)
    expect(result[:late_fees]).to eq(32.0)
    expect(result[:early_discount]).to eq(76.0)
    expect(result[:service_tax]).to eq(18.2)
    expect(result[:final_total]).to eq(11936.7)
  end
end
`
  }
];
