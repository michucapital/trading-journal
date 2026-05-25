#region Using declarations
using System;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
using NinjaTrader.NinjaScript.AddOns;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
    public class JournalExporter : NinjaTrader.NinjaScript.AddOnBase
    {
        private static JournalExporter _instance;
        private Account targetAccount;

        // Static HttpClient — configured to NOT follow redirects (fixes MethodNotAllowed)
        private static readonly HttpClient httpClient = new HttpClient(
            new HttpClientHandler { AllowAutoRedirect = false }
        );

        // YOUR SETTINGS
        private readonly string apiUrl = "http://localhost:3000/api/trade";
        private readonly string apiSecret = "my_secret_token_123";
        private readonly string accountName = "DEMO4560079";

        // Deduplication: tracks last seen executionId to prevent double-fires
        private string lastExecutionId = string.Empty;

        public JournalExporter() { }

        public static JournalExporter Instance
        {
            get
            {
                if (_instance == null)
                {
                    _instance = new JournalExporter();
                    _instance.Initialize();
                }
                return _instance;
            }
        }

        private void Initialize()
        {
            lock (Account.All)
            {
                targetAccount = Account.All.FirstOrDefault(a => a.Name == accountName);
            }

            if (targetAccount != null)
            {
                targetAccount.ExecutionUpdate += OnExecutionUpdate;
                NinjaTrader.Code.Output.Process("JournalExporter connected: " + targetAccount.Name, PrintTo.OutputTab1);
            }
            else
            {
                NinjaTrader.Code.Output.Process(
                    "JournalExporter: Account '" + accountName + "' not found. " +
                    "Ensure NT8 is connected to your data feed before the AddOn loads.",
                    PrintTo.OutputTab1
                );
            }
        }

        private void OnExecutionUpdate(object sender, ExecutionEventArgs e)
        {
            if (e.Operation != Operation.Add)
                return;

            // Deduplicate: NT8 can fire ExecutionUpdate multiple times for the same fill
            string executionId = e.Execution.ExecutionId;
            if (executionId == lastExecutionId)
                return;
            lastExecutionId = executionId;

            string orderId       = e.Execution.OrderId;

            // MasterInstrument.Name returns clean "ES", not "ES JUN26"
            string instrument    = e.Execution.Instrument.MasterInstrument.Name;

            string action        = e.Execution.MarketPosition == MarketPosition.Long ? "Buy" : "Sell";
            int    quantity      = e.Quantity;
            double price         = e.Price;
            int    positionAfter = e.Execution.Position;
            DateTime time        = e.Time;

            int previousPosition = action == "Buy" ? positionAfter - quantity : positionAfter + quantity;
            string marker = Math.Abs(positionAfter) < Math.Abs(previousPosition) ? "Exit" : "Entry";

            // Force InvariantCulture: prevents Polish/EU locale comma decimal separator in JSON
            string priceStr = price.ToString("F4", CultureInfo.InvariantCulture);

            string jsonPayload = string.Format(
                CultureInfo.InvariantCulture,
                @"{{""executionId"":""{0}"",""orderId"":""{1}"",""instrument"":""{2}"",""action"":""{3}"",""quantity"":{4},""price"":{5},""marker"":""{6}"",""position"":{7},""timestamp"":""{8}""}}",
                executionId,
                orderId,
                instrument,
                action,
                quantity,
                priceStr,
                marker,
                positionAfter,
                time.ToString("o", CultureInfo.InvariantCulture)
            );

            NinjaTrader.Code.Output.Process("Sending " + marker + " [" + instrument + " @ " + priceStr + "]...", PrintTo.OutputTab1);

            Task.Run(async () => await SendDataToServer(jsonPayload));
        }

        private async Task SendDataToServer(string jsonPayload)
        {
            try
            {
                var request = new HttpRequestMessage(HttpMethod.Post, apiUrl)
                {
                    Content = new StringContent(jsonPayload, Encoding.UTF8, "application/json")
                };
                request.Headers.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", apiSecret);

                var response = await httpClient.SendAsync(request);

                if (response.IsSuccessStatusCode)
                {
                    NinjaTrader.Code.Output.Process("=> Saved.", PrintTo.OutputTab1);
                }
                else
                {
                    string body = await response.Content.ReadAsStringAsync();
                    NinjaTrader.Code.Output.Process("=> Error (" + response.StatusCode + "): " + body, PrintTo.OutputTab1);
                }
            }
            catch (Exception ex)
            {
                NinjaTrader.Code.Output.Process("=> HTTP Failed: " + ex.Message, PrintTo.OutputTab1);
            }
        }

        protected override void OnStateChange()
        {
            if (State == State.Terminated)
            {
                if (targetAccount != null)
                {
                    targetAccount.ExecutionUpdate -= OnExecutionUpdate;
                    targetAccount = null;
                }
            }
        }
    }

    public class JournalExporterBootstrapper : NinjaTrader.NinjaScript.AddOnBase
    {
        protected override void OnStateChange()
        {
            if (State == State.Active)
            {
                var _ = JournalExporter.Instance;
            }
        }
    }
}
